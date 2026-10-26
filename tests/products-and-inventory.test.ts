import test from "node:test";
import assert from "node:assert/strict";
import { MockAppsScriptClient } from "../src/lib/server/apps-script/mock-client";
import {
  validateProductCreate,
  validateProductUpdate,
  validateStockAdjustment,
  isValidQuantityForUnit,
  isDiscreteUnit,
} from "../src/lib/server/products/validation";
import { paisaToRupees, rupeesToPaisa, formatPaisa } from "../src/lib/money/format";
import { NextRequest } from "next/server";
import { GET as getProducts, POST as createProduct } from "../src/app/api/products/route";
import { GET as getProduct, PATCH as updateProduct } from "../src/app/api/products/[id]/route";
import { POST as adjustStock } from "../src/app/api/products/[id]/stock/route";
import { createSessionToken, SESSION_COOKIE_NAME } from "../src/lib/server/auth/session";

// ─── 1. Validation Tests ─────────────────────────────────────────────────────

test("Product Validation: unit discretization and quantity precision", () => {
  assert.equal(isDiscreteUnit("piece"), true);
  assert.equal(isDiscreteUnit("packet"), true);
  assert.equal(isDiscreteUnit("bottle"), true);
  assert.equal(isDiscreteUnit("kg"), false);
  assert.equal(isDiscreteUnit("litre"), false);
  assert.equal(isDiscreteUnit("metre"), false);

  // Discrete units reject fractional quantities
  assert.equal(isValidQuantityForUnit(5, "piece"), true);
  assert.equal(isValidQuantityForUnit(5.5, "piece"), false);

  // Continuous units allow up to 3 decimals
  assert.equal(isValidQuantityForUnit(1.25, "kg"), true);
  assert.equal(isValidQuantityForUnit(0.333, "litre"), true);
  assert.equal(isValidQuantityForUnit(-2, "kg"), false);
});

test("Product Validation: validateProductCreate requires name, valid unit, and integer paisa price", () => {
  // Empty payload
  const emptyRes = validateProductCreate({});
  assert.equal(emptyRes.success, false);
  if (!emptyRes.success) {
    const fields = emptyRes.errors.map((e) => e.field);
    assert.ok(fields.includes("name"));
    assert.ok(fields.includes("unit"));
    assert.ok(fields.includes("selling_price"));
  }

  // Non-integer or non-positive selling price
  const nonIntRes = validateProductCreate({
    name: "Wai Wai",
    unit: "packet",
    selling_price: 25.5, // Not integer paisa
  });
  assert.equal(nonIntRes.success, false);

  const negRes = validateProductCreate({
    name: "Wai Wai",
    unit: "packet",
    selling_price: -2500,
  });
  assert.equal(negRes.success, false);

  // Valid product input
  const validRes = validateProductCreate({
    name: "Wai Wai 75g",
    sku: "8901234567890",
    category: "Snacks",
    unit: "packet",
    selling_price: 2500, // NPR 25.00
    cost_price: 2000,    // NPR 20.00
    opening_quantity: 50,
    low_stock_threshold: 10,
    is_active: true,
  });
  assert.equal(validRes.success, true);
  if (validRes.success) {
    assert.equal(validRes.data.name, "Wai Wai 75g");
    assert.equal(validRes.data.selling_price, 2500);
    assert.equal(validRes.data.cost_price, 2000);
    assert.equal(validRes.data.opening_quantity, 50);
  }
});

test("Product Validation: validateProductUpdate accepts partial valid inputs and rejects invalid bounds", () => {
  const updateValid = validateProductUpdate({
    selling_price: 35000,
    is_active: false,
    category: "Grains",
  });
  assert.equal(updateValid.success, true);
  if (updateValid.success) {
    assert.equal(updateValid.data.selling_price, 35000);
    assert.equal(updateValid.data.is_active, false);
    assert.equal(updateValid.data.category, "Grains");
  }

  const updateInvalid = validateProductUpdate({
    selling_price: -100,
  });
  assert.equal(updateInvalid.success, false);
});

test("Product Validation: validateStockAdjustment enforces type, quantity >= 0, and non-empty reason", () => {
  // Missing reason
  const noReason = validateStockAdjustment({
    adjustment_type: "restock",
    quantity: 10,
    reason: "",
  });
  assert.equal(noReason.success, false);

  // Negative quantity
  const negQty = validateStockAdjustment({
    adjustment_type: "restock",
    quantity: -5,
    reason: "New delivery",
  });
  assert.equal(negQty.success, false);

  // Invalid adjustment type
  const badType = validateStockAdjustment({
    adjustment_type: "invalid_type",
    quantity: 5,
    reason: "Test",
  });
  assert.equal(badType.success, false);

  // Missing idempotency_key
  const noKey = validateStockAdjustment({
    adjustment_type: "damage",
    quantity: 3,
    reason: "Water damage near window",
  });
  assert.equal(noKey.success, false);

  // Valid adjustment
  const valid = validateStockAdjustment({
    adjustment_type: "damage",
    quantity: 3,
    reason: "Water damage near window",
    notes: "Discarded safely",
    idempotency_key: "idem-valid-test-1",
  });
  assert.equal(valid.success, true);
});

// ─── 2. Backend Client Product & Inventory CRUD Tests ────────────────────────

test("Product Backend: full product lifecycle (create, get, update, soft-delete)", async () => {
  const client = new MockAppsScriptClient();

  // 1. Create product
  const createRes = await client.createProduct({
    name: "Tokla Tea 500g",
    sku: "TOKLA-500",
    category: "Beverages",
    unit: "packet",
    selling_price: 32000, // NPR 320.00
    cost_price: 27000,    // NPR 270.00
    opening_quantity: 20,
    low_stock_threshold: 5,
    is_active: true,
  });

  assert.equal(createRes.success, true);
  if (!createRes.success) return;

  const product = createRes.data;
  assert.ok(product.product_id);
  assert.equal(product.name, "Tokla Tea 500g");
  assert.equal(product.stock_quantity, 20);
  assert.equal(product.is_active, true);

  // 2. Duplicate SKU rejection
  const dupRes = await client.createProduct({
    name: "Tokla Tea Duplicate",
    sku: "TOKLA-500",
    category: "Beverages",
    unit: "packet",
    selling_price: 32000,
  });
  assert.equal(dupRes.success, false);
  if (!dupRes.success) {
    assert.equal(dupRes.error.code, "DUPLICATE_RECORD");
  }

  // 3. Get product with adjustments
  const getRes = await client.getProduct(product.product_id);
  assert.equal(getRes.success, true);
  if (getRes.success) {
    assert.equal(getRes.data.product.name, "Tokla Tea 500g");
    assert.equal(getRes.data.adjustments.length, 0);
  }

  // 4. Update product
  const updateRes = await client.updateProduct(product.product_id, {
    selling_price: 33000, // NPR 330.00
    low_stock_threshold: 8,
  });
  assert.equal(updateRes.success, true);
  if (updateRes.success) {
    assert.equal(updateRes.data.selling_price, 33000);
    assert.equal(updateRes.data.low_stock_threshold, 8);
  }

  // 5. Soft-deactivate product
  const deactRes = await client.updateProduct(product.product_id, {
    is_active: false,
  });
  assert.equal(deactRes.success, true);
  if (deactRes.success) {
    assert.equal(deactRes.data.is_active, false);
  }

  // Reactivate
  const reactRes = await client.updateProduct(product.product_id, {
    is_active: true,
  });
  assert.equal(reactRes.success, true);
  if (reactRes.success) {
    assert.equal(reactRes.data.is_active, true);
  }
});

test("Product Backend: search, category filter, low stock filter, and summary KPI stats", async () => {
  const client = new MockAppsScriptClient();

  // Seed test catalog
  await client.createProduct({
    name: "Basmati Rice 25kg",
    sku: "RICE-BAS-25",
    category: "Rice & Grains",
    unit: "packet",
    selling_price: 320000,
    opening_quantity: 15,
    low_stock_threshold: 5,
    is_active: true,
  });

  await client.createProduct({
    name: "Masuro Daal 1kg",
    sku: "DAAL-MAS-01",
    category: "Lentils & Pulses",
    unit: "kg",
    selling_price: 18000,
    opening_quantity: 3, // Low stock (threshold 5)
    low_stock_threshold: 5,
    is_active: true,
  });

  await client.createProduct({
    name: "Sunflow Oil 1L",
    sku: "OIL-SUN-01",
    category: "Oils & Ghee",
    unit: "bottle",
    selling_price: 24000,
    opening_quantity: 0, // Out of stock
    low_stock_threshold: 5,
    is_active: true,
  });

  await client.createProduct({
    name: "Discontinued Soap",
    sku: "SOAP-DISC",
    category: "Personal Care",
    unit: "piece",
    selling_price: 5000,
    opening_quantity: 10,
    low_stock_threshold: 2,
    is_active: false, // Inactive
  });

  // 1. Search by name
  const searchName = await client.listProducts({ search: "Basmati" });
  assert.equal(searchName.success, true);
  if (searchName.success) {
    assert.equal(searchName.data.products.length, 1);
    assert.equal(searchName.data.products[0].name, "Basmati Rice 25kg");
  }

  // 2. Search by SKU
  const searchSku = await client.listProducts({ search: "OIL-SUN" });
  assert.equal(searchSku.success, true);
  if (searchSku.success) {
    assert.equal(searchSku.data.products.length, 1);
    assert.equal(searchSku.data.products[0].name, "Sunflow Oil 1L");
  }

  // 3. Category filter
  const catFilter = await client.listProducts({ category: "Lentils & Pulses" });
  assert.equal(catFilter.success, true);
  if (catFilter.success) {
    assert.equal(catFilter.data.products.length, 1);
    assert.equal(catFilter.data.products[0].name, "Masuro Daal 1kg");
  }

  // 4. Low stock filter
  const lowStock = await client.listProducts({ low_stock: true });
  assert.equal(lowStock.success, true);
  if (lowStock.success) {
    // Both Masuro Daal (3 <= 5) and Sunflow Oil (0 <= 5)
    assert.equal(lowStock.data.products.length, 2);
  }

  // 5. Status filter
  const activeOnly = await client.listProducts({ status: "active" });
  assert.equal(activeOnly.success, true);
  if (activeOnly.success) {
    assert.equal(activeOnly.data.products.length, 3);
  }

  const inactiveOnly = await client.listProducts({ status: "inactive" });
  assert.equal(inactiveOnly.success, true);
  if (inactiveOnly.success) {
    assert.equal(inactiveOnly.data.products.length, 1);
    assert.equal(inactiveOnly.data.products[0].name, "Discontinued Soap");
  }

  // 6. Summary KPI calculation
  const allList = await client.listProducts();
  assert.equal(allList.success, true);
  if (allList.success) {
    const summary = allList.data.summary;
    assert.equal(summary.totalCount, 4);
    assert.equal(summary.activeCount, 3);
    assert.equal(summary.inactiveCount, 1);
    assert.equal(summary.lowStockCount, 1); // Masuro Daal (3 > 0 and 3 <= 5)
    assert.equal(summary.outOfStockCount, 1); // Sunflow Oil (0 <= 0)
  }
});

test("Stock Adjustment: restock, damage, and audit correction with ledger audit trail", async () => {
  const client = new MockAppsScriptClient();

  const prodRes = await client.createProduct({
    name: "Aashirvaad Atta 5kg",
    category: "Rice & Grains",
    unit: "packet",
    selling_price: 45000,
    opening_quantity: 10,
    low_stock_threshold: 4,
    is_active: true,
  });

  assert.equal(prodRes.success, true);
  if (!prodRes.success) return;
  const prodId = prodRes.data.product_id;

  // 1. Restock (+15)
  const restockRes = await client.adjustStock(prodId, {
    adjustment_type: "restock",
    quantity: 15,
    reason: "Supplier shipment #892",
    notes: "Batch expiry 2027-12",
    idempotency_key: "idem-restock-892",
  });
  assert.equal(restockRes.success, true);
  if (restockRes.success) {
    assert.equal(restockRes.data.product.stock_quantity, 25);
    assert.equal(restockRes.data.adjustment.previous_stock, 10);
    assert.equal(restockRes.data.adjustment.quantity_change, 15);
    assert.equal(restockRes.data.adjustment.new_stock, 25);
    assert.equal(restockRes.data.adjustment.reason, "Supplier shipment #892");
  }

  // 2. Damage write-off (-2)
  const damageRes = await client.adjustStock(prodId, {
    adjustment_type: "damage",
    quantity: 2,
    reason: "Torn bags leaking flour",
    idempotency_key: "idem-damage-leaking",
  });
  assert.equal(damageRes.success, true);
  if (damageRes.success) {
    assert.equal(damageRes.data.product.stock_quantity, 23);
    assert.equal(damageRes.data.adjustment.quantity_change, -2);
    assert.equal(damageRes.data.adjustment.new_stock, 23);
  }

  // 3. Physical shelf count correction (Set to 20)
  const auditRes = await client.adjustStock(prodId, {
    adjustment_type: "correction",
    quantity: 20,
    reason: "End-of-month physical shelf count audit",
    idempotency_key: "idem-audit-correction",
  });
  assert.equal(auditRes.success, true);
  if (auditRes.success) {
    assert.equal(auditRes.data.product.stock_quantity, 20);
    assert.equal(auditRes.data.adjustment.previous_stock, 23);
    assert.equal(auditRes.data.adjustment.quantity_change, -3);
    assert.equal(auditRes.data.adjustment.new_stock, 20);
  }

  // 4. Verify full audit trail
  const detailRes = await client.getProduct(prodId);
  assert.equal(detailRes.success, true);
  if (detailRes.success) {
    assert.equal(detailRes.data.adjustments.length, 3);
    assert.equal(detailRes.data.product.stock_quantity, 20);
  }

  // 5. Idempotency test: duplicate adjustment with same idempotency_key returns cached result
  const key = "idemp-" + Math.random();
  const first = await client.adjustStock(prodId, {
    adjustment_type: "restock",
    quantity: 5,
    reason: "First submission",
    idempotency_key: key,
  });
  assert.equal(first.success, true);

  const second = await client.adjustStock(prodId, {
    adjustment_type: "restock",
    quantity: 5,
    reason: "Second submission retry",
    idempotency_key: key,
  });
  assert.equal(second.success, true);
  if (first.success && second.success) {
    // Quantities should not be double counted!
    assert.equal(first.data.product.stock_quantity, second.data.product.stock_quantity);
  }
});

// ─── 3. Financial & Paisa Precision Tests ────────────────────────────────────

test("Financial Precision: Paisa to Rupee conversion and bilingual formatting", () => {
  // Paisa to Rupees
  assert.equal(paisaToRupees(15000), 150);
  assert.equal(paisaToRupees(2550), 25.5);
  assert.equal(paisaToRupees(0), 0);
  assert.equal(paisaToRupees(null), 0);

  // Rupees to Paisa
  assert.equal(rupeesToPaisa(150), 15000);
  assert.equal(rupeesToPaisa("25.50"), 2550);
  assert.equal(rupeesToPaisa("0.05"), 5);

  // Format Paisa
  const formattedEn = formatPaisa(15000, "en");
  assert.ok(formattedEn.includes("150"));

  const formattedNe = formatPaisa(15000, "ne");
  assert.ok(formattedNe.includes("रु") && formattedNe.includes("150"));

  assert.equal(formatPaisa(null), "—");
});

// ─── 4. API Route Guarding Tests ─────────────────────────────────────────────

test("API Protection: unauthenticated calls to /api/products return 401 Unauthorized", async () => {
  const req = new NextRequest("http://localhost:3000/api/products");
  const res = await getProducts(req);
  assert.equal(res.status, 401);

  const postReq = new NextRequest("http://localhost:3000/api/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Unauth product" }),
  });
  const postRes = await createProduct(postReq);
  assert.equal(postRes.status, 401);
});

test("API Protection: unauthenticated calls to /api/products/[id] return 401 Unauthorized", async () => {
  const req = new NextRequest("http://localhost:3000/api/products/test-123");
  const context = { params: Promise.resolve({ id: "test-123" }) };
  const res = await getProduct(req, context);
  assert.equal(res.status, 401);

  const patchReq = new NextRequest("http://localhost:3000/api/products/test-123", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selling_price: 2000 }),
  });
  const patchRes = await updateProduct(patchReq, context);
  assert.equal(patchRes.status, 401);
});

test("API Protection: unauthenticated calls to /api/products/[id]/stock return 401 Unauthorized", async () => {
  const req = new NextRequest("http://localhost:3000/api/products/test-123/stock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adjustment_type: "restock", quantity: 5, reason: "Test" }),
  });
  const context = { params: Promise.resolve({ id: "test-123" }) };
  const res = await adjustStock(req, context);
  assert.equal(res.status, 401);
});

// ─── 5. Phase 6.1 Inventory Integrity & Hardening Tests ─────────────────────

test("Stock Idempotency: replaying same key returns cached result without double mutation", async () => {
  const client = new MockAppsScriptClient();

  const prodRes = await client.createProduct({
    name: "Wai Wai Noodles 75g",
    category: "Instant Food",
    unit: "packet",
    selling_price: 2500,
    opening_quantity: 10,
    is_active: true,
  });
  assert.equal(prodRes.success, true);
  if (!prodRes.success) return;
  const prodId = prodRes.data.product_id;

  const idempotencyKey = "restock-wai-wai-101";

  // First request: +20
  const firstRes = await client.adjustStock(prodId, {
    adjustment_type: "restock",
    quantity: 20,
    reason: "Factory carton delivery",
    idempotency_key: idempotencyKey,
  });

  assert.equal(firstRes.success, true);
  if (!firstRes.success) return;
  assert.equal(firstRes.data.product.stock_quantity, 30);
  assert.equal(firstRes.data.adjustment.previous_stock, 10);
  assert.equal(firstRes.data.adjustment.quantity_change, 20);
  assert.equal(firstRes.data.adjustment.new_stock, 30);
  const originalAdjustmentId = firstRes.data.adjustment.adjustment_id;

  // Replayed duplicate request with identical key: MUST NOT apply +20 again
  const duplicateRes = await client.adjustStock(prodId, {
    adjustment_type: "restock",
    quantity: 20,
    reason: "Factory carton delivery",
    idempotency_key: idempotencyKey,
  });

  assert.equal(duplicateRes.success, true);
  if (!duplicateRes.success) return;
  // Stock must still be 30, NOT 50
  assert.equal(duplicateRes.data.product.stock_quantity, 30);
  assert.equal(duplicateRes.data.adjustment.adjustment_id, originalAdjustmentId);

  // Verify adjustments ledger has only 1 entry for this key
  const history = await client.listInventoryAdjustments(prodId);
  assert.equal(history.success, true);
  if (history.success) {
    const matching = history.data.filter((a) => a.idempotency_key === idempotencyKey);
    assert.equal(matching.length, 1);
  }
});

test("Stock Idempotency: concurrent requests with identical idempotency key do not double-mutate", async () => {
  const client = new MockAppsScriptClient();

  const prodRes = await client.createProduct({
    name: "Himalayan Pink Salt 1kg",
    category: "Spices",
    unit: "packet",
    selling_price: 9000,
    opening_quantity: 5,
    is_active: true,
  });
  assert.equal(prodRes.success, true);
  if (!prodRes.success) return;
  const prodId = prodRes.data.product_id;

  const sharedKey = "concurrent-key-salt-999";

  // Simulate concurrent requests arriving simultaneously
  const [res1, res2] = await Promise.all([
    client.adjustStock(prodId, {
      adjustment_type: "restock",
      quantity: 10,
      reason: "Bulk shipment",
      idempotency_key: sharedKey,
    }),
    client.adjustStock(prodId, {
      adjustment_type: "restock",
      quantity: 10,
      reason: "Bulk shipment",
      idempotency_key: sharedKey,
    }),
  ]);

  assert.equal(res1.success, true);
  assert.equal(res2.success, true);
  if (res1.success && res2.success) {
    // Both should report final stock of 15, not 25
    assert.equal(res1.data.product.stock_quantity, 15);
    assert.equal(res2.data.product.stock_quantity, 15);
    assert.equal(res1.data.adjustment.adjustment_id, res2.data.adjustment.adjustment_id);
  }
});

test("Stock Integrity: rejects negative stock and leaves on-hand quantity unchanged", async () => {
  const client = new MockAppsScriptClient();

  const prodRes = await client.createProduct({
    name: "Sunlight Detergent 1kg",
    category: "Cleaning",
    unit: "packet",
    selling_price: 13000,
    opening_quantity: 4,
    is_active: true,
  });
  assert.equal(prodRes.success, true);
  if (!prodRes.success) return;
  const prodId = prodRes.data.product_id;

  // Attempt to decrease more than on-hand stock
  const overDecrease = await client.adjustStock(prodId, {
    adjustment_type: "decrease",
    quantity: 10,
    reason: "Customer return adjustment",
    idempotency_key: "idem-negative-attempt-1",
  });

  assert.equal(overDecrease.success, false);
  if (!overDecrease.success) {
    assert.equal(overDecrease.error.code, "VALIDATION_ERROR");
    assert.ok(overDecrease.error.message.includes("negative"));
  }

  // Attempt damage write-off greater than stock
  const overDamage = await client.adjustStock(prodId, {
    adjustment_type: "damage",
    quantity: 5,
    reason: "Water leakage",
    idempotency_key: "idem-negative-attempt-2",
  });

  assert.equal(overDamage.success, false);

  // Verify stock quantity remained strictly 4
  const current = await client.getProduct(prodId);
  assert.equal(current.success, true);
  if (current.success) {
    assert.equal(current.data.product.stock_quantity, 4);
    assert.equal(current.data.adjustments.length, 0);
  }
});

test("Stock Integrity: piece-based units reject fractional quantities, continuous units allow valid precision", async () => {
  const client = new MockAppsScriptClient();

  // 1. Discrete unit product (piece)
  const pieceProd = await client.createProduct({
    name: "Dettol Soap 75g",
    category: "Personal Care",
    unit: "piece",
    selling_price: 6000,
    opening_quantity: 10,
    is_active: true,
  });
  assert.equal(pieceProd.success, true);
  if (!pieceProd.success) return;

  // Fractional quantity adjustment on piece unit must fail
  const pieceAdj = await client.adjustStock(pieceProd.data.product_id, {
    adjustment_type: "restock",
    quantity: 2.5,
    reason: "Fractional pieces delivery",
    idempotency_key: "idem-piece-frac",
  });
  assert.equal(pieceAdj.success, false);
  if (!pieceAdj.success) {
    assert.equal(pieceAdj.error.code, "VALIDATION_ERROR");
    assert.ok(pieceAdj.error.message.includes("whole number"));
  }

  // 2. Continuous unit product (kg)
  const kgProd = await client.createProduct({
    name: "Chana Dal (Loose)",
    category: "Pulses",
    unit: "kg",
    selling_price: 18000,
    opening_quantity: 20,
    is_active: true,
  });
  assert.equal(kgProd.success, true);
  if (!kgProd.success) return;

  // Valid fractional quantity (up to 3 decimal places) succeeds
  const validKgAdj = await client.adjustStock(kgProd.data.product_id, {
    adjustment_type: "damage",
    quantity: 1.75,
    reason: "Spill cleaning",
    idempotency_key: "idem-kg-valid-frac",
  });
  assert.equal(validKgAdj.success, true);
  if (validKgAdj.success) {
    assert.equal(validKgAdj.data.product.stock_quantity, 18.25);
  }

  // Excessive decimal precision (>3 decimal places) must fail
  const invalidPrecisionAdj = await client.adjustStock(kgProd.data.product_id, {
    adjustment_type: "restock",
    quantity: 2.12345,
    reason: "Invalid scale precision",
    idempotency_key: "idem-kg-invalid-precision",
  });
  assert.equal(invalidPrecisionAdj.success, false);
  if (!invalidPrecisionAdj.success) {
    assert.equal(invalidPrecisionAdj.error.code, "VALIDATION_ERROR");
    assert.ok(invalidPrecisionAdj.error.message.includes("decimal places"));
  }
});

test("Audit Ledger: preserves actor, idempotency key, previous stock, new stock, and timestamp", async () => {
  const client = new MockAppsScriptClient();

  const prodRes = await client.createProduct({
    name: "Fortune Mustard Oil 1L",
    category: "Oils",
    unit: "bottle",
    selling_price: 24000,
    opening_quantity: 8,
    is_active: true,
  });
  assert.equal(prodRes.success, true);
  if (!prodRes.success) return;
  const prodId = prodRes.data.product_id;

  const adjResult = await client.adjustStock(prodId, {
    adjustment_type: "restock",
    quantity: 12,
    reason: "Distributor shipment invoice #INV-4412",
    notes: "Verified by store supervisor",
    actor: "nirmal_owner",
    idempotency_key: "idem-audit-actor-check",
  });

  assert.equal(adjResult.success, true);
  if (!adjResult.success) return;

  const adj = adjResult.data.adjustment;
  assert.equal(adj.actor, "nirmal_owner");
  assert.equal(adj.idempotency_key, "idem-audit-actor-check");
  assert.equal(adj.previous_stock, 8);
  assert.equal(adj.new_stock, 20);
  assert.equal(adj.quantity_change, 12);
  assert.equal(adj.reason, "Distributor shipment invoice #INV-4412");
  assert.equal(adj.notes, "Verified by store supervisor");
  assert.ok(adj.created_at && !isNaN(new Date(adj.created_at).getTime()));
});

test("Product Validation: case-insensitive duplicate SKU rejection and trimming", async () => {
  const client = new MockAppsScriptClient();

  const firstProd = await client.createProduct({
    name: "Red Bull Energy Drink 250ml",
    sku: "REDBULL-250",
    category: "Beverages",
    unit: "bottle",
    selling_price: 22000,
    opening_quantity: 12,
  });
  assert.equal(firstProd.success, true);

  // Attempt duplicate SKU with lowercase and leading/trailing whitespace
  const dupProd = await client.createProduct({
    name: "Red Bull Energy Drink (Duplicate)",
    sku: "  redbull-250  ",
    category: "Beverages",
    unit: "bottle",
    selling_price: 22000,
    opening_quantity: 6,
  });

  assert.equal(dupProd.success, false);
  if (!dupProd.success) {
    assert.equal(dupProd.error.code, "DUPLICATE_RECORD");
    assert.ok(dupProd.error.message.includes("already exists"));
  }

  // Attempt update to duplicate existing SKU
  const secondProd = await client.createProduct({
    name: "Sting Energy Drink 250ml",
    sku: "STING-250",
    category: "Beverages",
    unit: "bottle",
    selling_price: 6000,
  });
  assert.equal(secondProd.success, true);
  if (!secondProd.success) return;

  const dupUpdate = await client.updateProduct(secondProd.data.product_id, {
    sku: "redbull-250",
  });
  assert.equal(dupUpdate.success, false);
  if (!dupUpdate.success) {
    assert.equal(dupUpdate.error.code, "DUPLICATE_RECORD");
  }
});

test("Product Deactivation: preserves stock quantity and historical adjustments ledger", async () => {
  const client = new MockAppsScriptClient();

  // Create active product with initial stock
  const createRes = await client.createProduct({
    name: "Seasonal Mango Juice 1L",
    category: "Beverages",
    unit: "bottle",
    selling_price: 15000,
    opening_quantity: 20,
    is_active: true,
  });
  assert.equal(createRes.success, true);
  if (!createRes.success) return;
  const prodId = createRes.data.product_id;

  // Make two adjustments
  await client.adjustStock(prodId, {
    adjustment_type: "restock",
    quantity: 10,
    reason: "Mid-season restock",
    idempotency_key: "seasonal-restock-1",
  });
  await client.adjustStock(prodId, {
    adjustment_type: "damage",
    quantity: 3,
    reason: "Damaged seal on transport",
    idempotency_key: "seasonal-damage-1",
  });

  // Verify stock is 27
  const beforeDeactivate = await client.getProduct(prodId);
  assert.equal(beforeDeactivate.success, true);
  if (beforeDeactivate.success) {
    assert.equal(beforeDeactivate.data.product.stock_quantity, 27);
    assert.equal(beforeDeactivate.data.adjustments.length, 2);
  }

  // Deactivate product (soft-delete)
  const deactivateRes = await client.updateProduct(prodId, { is_active: false });
  assert.equal(deactivateRes.success, true);
  if (deactivateRes.success) {
    assert.equal(deactivateRes.data.is_active, false);
    // Stock quantity must remain preserved
    assert.equal(deactivateRes.data.stock_quantity, 27);
  }

  // Verify product detail still retrieves all historical adjustments
  const afterDeactivate = await client.getProduct(prodId);
  assert.equal(afterDeactivate.success, true);
  if (afterDeactivate.success) {
    assert.equal(afterDeactivate.data.product.is_active, false);
    assert.equal(afterDeactivate.data.product.stock_quantity, 27);
    assert.equal(afterDeactivate.data.adjustments.length, 2);
  }

  // Reactivate product
  const reactivateRes = await client.updateProduct(prodId, { is_active: true });
  assert.equal(reactivateRes.success, true);
  if (reactivateRes.success) {
    assert.equal(reactivateRes.data.is_active, true);
    assert.equal(reactivateRes.data.stock_quantity, 27);
  }
});

test("API Protection: rejects cross-origin mutating requests with 403 Forbidden", async () => {
  process.env.SESSION_SECRET = "super-secret-key-at-least-32-chars-long-test-token!";
  process.env.OWNER_USERNAME = "owner";
  process.env.OWNER_PASSWORD_HASH = "scrypt$N=16384,r=8,p=1$mock$mockhash";

  try {
    const { token } = await createSessionToken("owner");

    // 1. Cross-origin POST /api/products
    const crossOriginCreate = new NextRequest("http://localhost:3000/api/products", {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
        "Content-Type": "application/json",
        origin: "https://malicious-phishing-site.com",
      },
      body: JSON.stringify({ name: "Cross origin test", unit: "piece", selling_price: 1000 }),
    });
    const resCreate = await createProduct(crossOriginCreate);
    assert.equal(resCreate.status, 403);
    const bodyCreate = await resCreate.json();
    assert.equal(bodyCreate.error.code, "UNAUTHORIZED");
    assert.ok(bodyCreate.error.message.includes("Cross-origin"));

    // 2. Cross-origin Sec-Fetch-Site PATCH /api/products/[id]
    const crossFetchSitePatch = new NextRequest("http://localhost:3000/api/products/test-1", {
      method: "PATCH",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
        "Content-Type": "application/json",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ name: "Cross-site name patch" }),
    });
    const resPatch = await updateProduct(crossFetchSitePatch, {
      params: Promise.resolve({ id: "test-1" }),
    });
    assert.equal(resPatch.status, 403);

    // 3. Cross-origin POST /api/products/[id]/stock
    const crossOriginStock = new NextRequest("http://localhost:3000/api/products/test-1/stock", {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
        "Content-Type": "application/json",
        origin: "http://evil-site.org",
      },
      body: JSON.stringify({
        adjustment_type: "restock",
        quantity: 10,
        reason: "Cross origin stock inject",
        idempotency_key: "csrf-key-1",
      }),
    });
    const resStock = await adjustStock(crossOriginStock, {
      params: Promise.resolve({ id: "test-1" }),
    });
    assert.equal(resStock.status, 403);
  } finally {
    delete process.env.SESSION_SECRET;
    delete process.env.OWNER_USERNAME;
    delete process.env.OWNER_PASSWORD_HASH;
  }
});
