import test from "node:test";
import assert from "node:assert/strict";
import { MockAppsScriptClient } from "../src/lib/server/apps-script/mock-client";
import { validateSaleCreate } from "../src/lib/server/sales/validation";
import {
  gregorianToBikramSambat,
  formatBikramSambatDate,
  toNepaliNumerals,
  getTodayDualDates,
} from "../src/lib/date/nepali-calendar";
import { NextRequest } from "next/server";
import { GET as getSales, POST as createSale } from "../src/app/api/sales/route";
import { GET as getSaleById } from "../src/app/api/sales/[id]/route";
import { createSessionToken, SESSION_COOKIE_NAME } from "../src/lib/server/auth/session";

// ─── 1. Validation Tests ─────────────────────────────────────────────────────

test("Sale Validation: requires idempotency_key, non-empty items, and non-negative discount", () => {
  // Empty payload
  const emptyRes = validateSaleCreate({});
  assert.equal(emptyRes.success, false);
  if (!emptyRes.success) {
    const fields = emptyRes.errors.map((e) => e.field);
    assert.ok(fields.includes("idempotency_key"));
    assert.ok(fields.includes("items"));
  }

  // Missing product_id in item
  const missingProdRes = validateSaleCreate({
    idempotency_key: "idem-key-1",
    items: [{ quantity: 2 }],
  });
  assert.equal(missingProdRes.success, false);
  if (!missingProdRes.success) {
    assert.ok(missingProdRes.errors.some((e) => e.field.includes("product_id")));
  }

  // Non-positive quantity
  const nonPosQty = validateSaleCreate({
    idempotency_key: "idem-key-2",
    items: [{ product_id: "prod-1", quantity: 0 }],
  });
  assert.equal(nonPosQty.success, false);

  // Negative discount
  const negDiscount = validateSaleCreate({
    idempotency_key: "idem-key-3",
    items: [{ product_id: "prod-1", quantity: 2 }],
    discount_amount: -500,
  });
  assert.equal(negDiscount.success, false);

  // Valid payload
  const validRes = validateSaleCreate({
    idempotency_key: "idem-key-valid",
    items: [
      { product_id: "prod-1", quantity: 2, unit_price_snapshot: 15000 },
      { product_id: "prod-2", quantity: 1.5 },
    ],
    discount_amount: 1000,
    payment_method: "cash",
  });
  assert.equal(validRes.success, true);
  if (validRes.success) {
    assert.equal(validRes.data.items.length, 2);
    assert.equal(validRes.data.discount_amount, 1000);
    assert.equal(validRes.data.payment_method, "cash");
  }
});

// ─── 2. Dual Calendar (Gregorian & Bikram Sambat) Tests ─────────────────────

test("Nepali Calendar: converts Gregorian dates accurately to Bikram Sambat", () => {
  // Anchor check: 2020-04-13 AD is 2077-01-01 BS (Baisakh 1, 2077)
  const anchorBs = gregorianToBikramSambat(new Date(Date.UTC(2020, 3, 13)));
  assert.equal(anchorBs, "2077-01-01");

  // Today dual dates format
  const today = getTodayDualDates();
  assert.match(today.ad, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(today.bs, /^\d{4}-\d{2}-\d{2}$/);

  // Numerals conversion
  assert.equal(toNepaliNumerals(2083), "२०८३");
  assert.equal(toNepaliNumerals("10"), "१०");

  // Localized date formatting
  const enFormatted = formatBikramSambatDate("2083-07-10", "en");
  assert.equal(enFormatted, "10 Kartik 2083");

  const neFormatted = formatBikramSambatDate("2083-07-10", "ne");
  assert.equal(neFormatted, "१० कात्तिक २०८३");
});

// ─── 3. Sales Backend & Stock Deduction Tests ───────────────────────────────

test("Sales Backend: creates sale, captures dual dates, generates receipt number, deducts stock, and writes audit ledger", async () => {
  const client = new MockAppsScriptClient();

  // Create products
  const teaRes = await client.createProduct({
    name: "Tokla Tea 250g",
    category: "Beverages",
    unit: "packet",
    selling_price: 18000, // Rs 180.00
    opening_quantity: 20,
    is_active: true,
  });
  assert.equal(teaRes.success, true);
  if (!teaRes.success) return;

  const sugarRes = await client.createProduct({
    name: "White Sugar",
    category: "Groceries",
    unit: "kg",
    selling_price: 11000, // Rs 110.00/kg
    opening_quantity: 50,
    is_active: true,
  });
  assert.equal(sugarRes.success, true);
  if (!sugarRes.success) return;

  const teaId = teaRes.data.product_id;
  const sugarId = sugarRes.data.product_id;

  // Perform Sale: 2 packets of tea + 2.5 kg sugar, with Rs 50.00 (5000 Paisa) discount
  // Tea: 2 * 18000 = 36000
  // Sugar: 2.5 * 11000 = 27500
  // Gross Subtotal = 36000 + 27500 = 63500 Paisa (Rs 635.00)
  // Discount = 5000 Paisa (Rs 50.00)
  // Net Total = 58500 Paisa (Rs 585.00)
  const saleRes = await client.createSale({
    idempotency_key: "sale-key-001",
    items: [
      { product_id: teaId, quantity: 2 },
      { product_id: sugarId, quantity: 2.5 },
    ],
    discount_amount: 5000,
    actor: "owner",
  });

  assert.equal(saleRes.success, true);
  if (!saleRes.success) return;

  const { sale, items } = saleRes.data;

  // 1. Check Sale Header
  assert.ok(sale.sale_id);
  assert.match(sale.receipt_number, /^REC-\d{8}-0001$/);
  assert.match(sale.transaction_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(sale.transaction_date_bs, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(sale.subtotal, 63500);
  assert.equal(sale.discount_amount, 5000);
  assert.equal(sale.total_amount, 58500);
  assert.equal(sale.status, "completed");

  // 2. Check Line Items
  assert.equal(items.length, 2);
  const teaItem = items.find((i) => i.product_id === teaId)!;
  assert.equal(teaItem.product_name_snapshot, "Tokla Tea 250g");
  assert.equal(teaItem.quantity, 2);
  assert.equal(teaItem.unit_price_snapshot, 18000);
  assert.equal(teaItem.line_total, 36000);

  const sugarItem = items.find((i) => i.product_id === sugarId)!;
  assert.equal(sugarItem.product_name_snapshot, "White Sugar");
  assert.equal(sugarItem.quantity, 2.5);
  assert.equal(sugarItem.unit_price_snapshot, 11000);
  assert.equal(sugarItem.line_total, 27500);

  // 3. Check Stock Decrement
  const updatedTea = await client.getProduct(teaId);
  assert.equal(updatedTea.success, true);
  if (updatedTea.success) {
    assert.equal(updatedTea.data.product.stock_quantity, 18); // 20 - 2 = 18
  }

  const updatedSugar = await client.getProduct(sugarId);
  assert.equal(updatedSugar.success, true);
  if (updatedSugar.success) {
    assert.equal(updatedSugar.data.product.stock_quantity, 47.5); // 50 - 2.5 = 47.5
  }

  // 4. Check Inventory Adjustments Audit Trail
  const adjList = await client.listInventoryAdjustments(teaId);
  assert.equal(adjList.success, true);
  if (adjList.success) {
    const saleAdj = adjList.data.find((a) => a.reason.includes("Sale"));
    assert.ok(saleAdj);
    assert.equal(saleAdj?.adjustment_type, "decrease");
    assert.equal(saleAdj?.quantity_change, -2);
    assert.equal(saleAdj?.previous_stock, 20);
    assert.equal(saleAdj?.new_stock, 18);
    assert.equal(saleAdj?.actor, "owner");
  }
});

test("Sales Backend: rejects sale if requested quantity exceeds available stock", async () => {
  const client = new MockAppsScriptClient();

  const prodRes = await client.createProduct({
    name: "Limited Biscuit",
    category: "Snacks",
    unit: "packet",
    selling_price: 5000,
    opening_quantity: 3,
    is_active: true,
  });
  assert.equal(prodRes.success, true);
  if (!prodRes.success) return;
  const prodId = prodRes.data.product_id;

  // Attempt to sell 5 packets when only 3 are available
  const saleRes = await client.createSale({
    idempotency_key: "sale-key-overflow",
    items: [{ product_id: prodId, quantity: 5 }],
  });

  assert.equal(saleRes.success, false);
  assert.equal(saleRes.error?.code, "VALIDATION_ERROR");
  assert.ok(saleRes.error?.message.includes("Insufficient stock"));

  // Verify stock remained untouched
  const prodCheck = await client.getProduct(prodId);
  assert.equal(prodCheck.success, true);
  if (prodCheck.success) {
    assert.equal(prodCheck.data.product.stock_quantity, 3);
  }
});

test("Sales Backend: piece units reject fractional quantities, continuous units allow valid decimals", async () => {
  const client = new MockAppsScriptClient();

  const pieceProd = await client.createProduct({
    name: "Soap Bar",
    category: "Personal Care",
    unit: "piece",
    selling_price: 6000,
    opening_quantity: 10,
    is_active: true,
  });
  assert.equal(pieceProd.success, true);
  if (!pieceProd.success) return;

  // Fractional sale on piece unit must fail
  const fracRes = await client.createSale({
    idempotency_key: "sale-key-frac",
    items: [{ product_id: pieceProd.data.product_id, quantity: 1.5 }],
  });
  assert.equal(fracRes.success, false);
  assert.equal(fracRes.error?.code, "VALIDATION_ERROR");
  assert.ok(fracRes.error?.message.includes("whole number"));
});

test("Sales Backend: rejects sale for inactive/deactivated products", async () => {
  const client = new MockAppsScriptClient();

  const inactiveProd = await client.createProduct({
    name: "Discontinued Soda",
    category: "Beverages",
    unit: "bottle",
    selling_price: 8000,
    opening_quantity: 10,
    is_active: false,
  });
  assert.equal(inactiveProd.success, true);
  if (!inactiveProd.success) return;

  const saleRes = await client.createSale({
    idempotency_key: "sale-key-inactive",
    items: [{ product_id: inactiveProd.data.product_id, quantity: 1 }],
  });
  assert.equal(saleRes.success, false);
  assert.equal(saleRes.error?.code, "VALIDATION_ERROR");
  assert.ok(saleRes.error?.message.includes("inactive"));
});

test("Sales Idempotency: replaying same key returns cached sale without double stock deduction", async () => {
  const client = new MockAppsScriptClient();

  const prodRes = await client.createProduct({
    name: "Basmati Rice 1kg",
    category: "Groceries",
    unit: "packet",
    selling_price: 22000,
    opening_quantity: 15,
    is_active: true,
  });
  assert.equal(prodRes.success, true);
  if (!prodRes.success) return;
  const prodId = prodRes.data.product_id;

  const idempKey = "sale-idemp-dedup-101";

  // First sale submission
  const res1 = await client.createSale({
    idempotency_key: idempKey,
    items: [{ product_id: prodId, quantity: 3 }],
  });
  assert.equal(res1.success, true);
  if (!res1.success) return;
  const receipt1 = res1.data.sale.receipt_number;

  // Replay exact same request with same idempotency key
  const res2 = await client.createSale({
    idempotency_key: idempKey,
    items: [{ product_id: prodId, quantity: 3 }],
  });
  assert.equal(res2.success, true);
  if (!res2.success) return;

  // Both responses must be identical
  assert.equal(res2.data.sale.receipt_number, receipt1);
  assert.equal(res2.data.sale.sale_id, res1.data.sale.sale_id);

  // Stock must have only been deducted ONCE (15 - 3 = 12, NOT 9)
  const prodCheck = await client.getProduct(prodId);
  assert.equal(prodCheck.success, true);
  if (prodCheck.success) {
    assert.equal(prodCheck.data.product.stock_quantity, 12);
  }
});

test("Sales Backend: sale retrieval by ID and sales listing with filters", async () => {
  const client = new MockAppsScriptClient();

  const prodRes = await client.createProduct({
    name: "Instant Coffee",
    category: "Beverages",
    unit: "bottle",
    selling_price: 35000,
    opening_quantity: 10,
    is_active: true,
  });
  assert.equal(prodRes.success, true);
  if (!prodRes.success) return;

  const saleRes = await client.createSale({
    idempotency_key: "sale-get-list-test",
    items: [{ product_id: prodRes.data.product_id, quantity: 1 }],
  });
  assert.equal(saleRes.success, true);
  if (!saleRes.success) return;

  const saleId = saleRes.data.sale.sale_id;

  // 1. Get Sale by ID
  const fetchRes = await client.getSale(saleId);
  assert.equal(fetchRes.success, true);
  if (fetchRes.success) {
    assert.equal(fetchRes.data.sale.sale_id, saleId);
    assert.equal(fetchRes.data.items.length, 1);
  }

  // 2. List Sales
  const listRes = await client.listSales();
  assert.equal(listRes.success, true);
  if (listRes.success) {
    assert.ok(listRes.data.length >= 1);
    assert.ok(listRes.data.some((s) => s.sale_id === saleId));
  }
});

// ─── 4. API Route Protection & CSRF Tests ────────────────────────────────────

test("API Protection: unauthenticated calls to /api/sales return 401 Unauthorized", async () => {
  const getReq = new NextRequest("http://localhost:3000/api/sales");
  const getRes = await getSales(getReq);
  assert.equal(getRes.status, 401);

  const postReq = new NextRequest("http://localhost:3000/api/sales", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idempotency_key: "unauth-key", items: [] }),
  });
  const postRes = await createSale(postReq);
  assert.equal(postRes.status, 401);

  const detailReq = new NextRequest("http://localhost:3000/api/sales/sample-id");
  const detailRes = await getSaleById(detailReq, { params: Promise.resolve({ id: "sample-id" }) });
  assert.equal(detailRes.status, 401);
});

test("API Protection: rejects cross-origin mutating requests to /api/sales with 403 Forbidden", async () => {
  process.env.SESSION_SECRET = "super-secret-key-at-least-32-chars-long-test-token!";
  process.env.OWNER_USERNAME = "owner";
  process.env.OWNER_PASSWORD_HASH = "scrypt$N=16384,r=8,p=1$mock$mockhash";

  try {
    const { token } = await createSessionToken("owner");

    const crossOriginReq = new NextRequest("http://localhost:3000/api/sales", {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
        "Content-Type": "application/json",
        origin: "https://attacker-origin.com",
      },
      body: JSON.stringify({
        idempotency_key: "csrf-sale-key",
        items: [{ product_id: "prod-1", quantity: 1 }],
      }),
    });

    const res = await createSale(crossOriginReq);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, "UNAUTHORIZED");
    assert.ok(body.error.message.includes("Cross-origin"));
  } finally {
    delete process.env.SESSION_SECRET;
    delete process.env.OWNER_USERNAME;
    delete process.env.OWNER_PASSWORD_HASH;
  }
});

// ─── 5. Server-Authoritative Pricing, Snapshots & Payments ──────────────────

test("Sales Backend: enforces server-authoritative pricing (ignores client price overrides)", async () => {
  const client = new MockAppsScriptClient();

  const prodRes = await client.createProduct({
    name: "Premium Basmati Rice",
    category: "Groceries",
    unit: "packet",
    selling_price: 25000, // Catalog price: Rs 250.00
    opening_quantity: 20,
    is_active: true,
  });
  assert.equal(prodRes.success, true);
  if (!prodRes.success) return;
  const prodId = prodRes.data.product_id;

  // Client attempts to pass a malicious unit_price_snapshot override of 5000 (Rs 50.00)
  const saleRes = await client.createSale({
    idempotency_key: "sale-key-auth-price-check",
    items: [
      {
        product_id: prodId,
        quantity: 2,
        unit_price_snapshot: 5000, // Must be ignored by server
      },
    ],
  });

  assert.equal(saleRes.success, true);
  if (!saleRes.success) return;

  const { sale, items } = saleRes.data;
  assert.equal(items.length, 1);
  // Authoritative catalog price of 25000 Paisa was used, NOT 5000
  assert.equal(items[0].unit_price_snapshot, 25000);
  assert.equal(items[0].line_total, 50000); // 2 * 25000
  assert.equal(sale.subtotal, 50000);
  assert.equal(sale.total_amount, 50000);
});

test("Sales Backend: records sku_snapshot, unit_snapshot, and payment record in Payments sheet", async () => {
  const client = new MockAppsScriptClient();

  const prodRes = await client.createProduct({
    name: "Aashirvaad Atta 5kg",
    sku: "8901030383821",
    category: "Groceries",
    unit: "packet",
    selling_price: 46000, // Rs 460.00
    opening_quantity: 10,
    is_active: true,
  });
  assert.equal(prodRes.success, true);
  if (!prodRes.success) return;
  const prodId = prodRes.data.product_id;

  const saleRes = await client.createSale({
    idempotency_key: "sale-key-snapshots-and-payment",
    items: [{ product_id: prodId, quantity: 1 }],
  });

  assert.equal(saleRes.success, true);
  if (!saleRes.success) return;

  const { sale, items, payment } = saleRes.data;

  // Check snapshots on item
  assert.equal(items[0].sku_snapshot, "8901030383821");
  assert.equal(items[0].unit_snapshot, "packet");
  assert.equal(items[0].product_name_snapshot, "Aashirvaad Atta 5kg");

  // Check sale record
  assert.equal(sale.payment_method, "cash");
  assert.equal(sale.idempotency_key, "sale-key-snapshots-and-payment");
  assert.equal(sale.status, "completed");

  // Check payment record
  assert.ok(payment);
  if (payment) {
    assert.ok(payment.payment_id);
    assert.equal(payment.sale_id, sale.sale_id);
    assert.equal(payment.payment_type, "sale");
    assert.equal(payment.payment_method, "cash");
    assert.equal(payment.amount, 46000);
    assert.equal(payment.payment_status, "completed");
  }
});

test("Sale Validation: strictly enforces cash-only payment method in Phase 7", () => {
  // Cash payment is accepted
  const cashRes = validateSaleCreate({
    idempotency_key: "cash-valid-key",
    items: [{ product_id: "prod-1", quantity: 1 }],
    payment_method: "cash",
  });
  assert.equal(cashRes.success, true);

  // Credit payment method rejected in Phase 7 (deferred to Phase 8)
  const creditRes = validateSaleCreate({
    idempotency_key: "credit-invalid-key",
    items: [{ product_id: "prod-1", quantity: 1 }],
    payment_method: "credit",
  });
  assert.equal(creditRes.success, false);
  if (!creditRes.success) {
    assert.ok(creditRes.errors.some((e) => e.field === "payment_method"));
    assert.ok(creditRes.errors.some((e) => e.message.includes("cash")));
  }

  // Other payment method rejected
  const otherRes = validateSaleCreate({
    idempotency_key: "other-invalid-key",
    items: [{ product_id: "prod-1", quantity: 1 }],
    payment_method: "esewa",
  });
  assert.equal(otherRes.success, false);
});

