import type { SheetDefinition, SheetName, SheetStatusReport } from "./types";

/**
 * Authoritative schema definition for General Store Management Google Sheets database.
 * Every monetary field is tracked in integer Paisa (1 NPR = 100 Paisa).
 * All timestamps follow ISO 8601 UTC representation (e.g. 2026-10-25T14:30:00.000Z).
 */
export const DATABASE_SHEETS: readonly SheetDefinition[] = [
  {
    name: "Products",
    description: "Inventory items catalog with pricing in Paisa and active flags.",
    primaryKey: "product_id",
    headers: [
      "product_id",
      "name",
      "category",
      "unit",
      "selling_price",
      "cost_price",
      "stock_quantity",
      "is_active",
      "created_at",
      "updated_at",
      "sku",
      "opening_quantity",
      "low_stock_threshold",
    ],
    fields: [
      { name: "product_id", type: "string", required: true, description: "UUID v4 primary key" },
      { name: "name", type: "string", required: true, description: "Product display name in Nepali/English" },
      { name: "category", type: "string", required: true, description: "Item category, e.g. Grains, Dairy, Spices" },
      { name: "unit", type: "string", required: true, description: "Unit of measurement, e.g. kg, packet, piece, liter" },
      { name: "selling_price", type: "integer", required: true, isPaisaAmount: true, description: "Selling price in Paisa (1 NPR = 100 Paisa)" },
      { name: "cost_price", type: "integer", required: false, isPaisaAmount: true, description: "Optional cost price in Paisa for margin tracking" },
      { name: "stock_quantity", type: "number", required: false, description: "Current inventory count (decimal or integer)" },
      { name: "is_active", type: "boolean", required: true, description: "Active status flag (TRUE / FALSE)" },
      { name: "created_at", type: "datetime", required: true, description: "ISO 8601 UTC creation timestamp" },
      { name: "updated_at", type: "datetime", required: true, description: "ISO 8601 UTC last update timestamp" },
      { name: "sku", type: "string", required: false, description: "Optional unique product SKU or barcode" },
      { name: "opening_quantity", type: "number", required: false, description: "Initial stock quantity when product was created" },
      { name: "low_stock_threshold", type: "number", required: false, description: "Low-stock warning threshold quantity (default: 5)" },
    ],
  },
  {
    name: "InventoryAdjustments",
    description: "Audit ledger of stock adjustments, restocks, damage write-offs, and count corrections.",
    primaryKey: "adjustment_id",
    headers: [
      "adjustment_id",
      "product_id",
      "adjustment_type",
      "quantity_change",
      "previous_stock",
      "new_stock",
      "reason",
      "notes",
      "actor",
      "idempotency_key",
      "created_at",
    ],
    fields: [
      { name: "adjustment_id", type: "string", required: true, description: "UUID v4 primary key" },
      { name: "product_id", type: "string", required: true, description: "Foreign key reference to Products.product_id" },
      { name: "adjustment_type", type: "string", required: true, allowedValues: ["set", "increase", "decrease", "restock", "damage", "correction"], description: "Type of stock adjustment" },
      { name: "quantity_change", type: "number", required: true, description: "Quantity changed (delta)" },
      { name: "previous_stock", type: "number", required: true, description: "On-hand stock before adjustment" },
      { name: "new_stock", type: "number", required: true, description: "Resulting on-hand stock after adjustment" },
      { name: "reason", type: "string", required: true, description: "Mandatory operator reason for the adjustment" },
      { name: "notes", type: "string", required: false, description: "Optional additional notes or supplier invoice references" },
      { name: "actor", type: "string", required: false, description: "Username or identifier of the operator performing the adjustment" },
      { name: "idempotency_key", type: "string", required: true, description: "Client-generated UUID to prevent duplicate mutations" },
      { name: "created_at", type: "datetime", required: true, description: "ISO 8601 UTC creation timestamp" },
    ],
  },
  {
    name: "Customers",
    description: "Customer registry for store credits (Udhaar) and transaction tracking.",
    primaryKey: "customer_id",
    headers: [
      "customer_id",
      "name",
      "phone",
      "address",
      "notes",
      "is_active",
      "created_at",
      "updated_at",
    ],
    fields: [
      { name: "customer_id", type: "string", required: true, description: "UUID v4 primary key" },
      { name: "name", type: "string", required: true, description: "Customer full name" },
      { name: "phone", type: "string", required: true, description: "Primary contact phone number" },
      { name: "address", type: "string", required: false, description: "Local address or neighborhood description" },
      { name: "notes", type: "string", required: false, description: "Operator notes on credit limits or terms" },
      { name: "is_active", type: "boolean", required: true, description: "Active status flag (TRUE / FALSE)" },
      { name: "created_at", type: "datetime", required: true, description: "ISO 8601 UTC creation timestamp" },
      { name: "updated_at", type: "datetime", required: true, description: "ISO 8601 UTC last update timestamp" },
    ],
  },
  {
    name: "Sales",
    description: "Sales transactions header records with amounts in Paisa.",
    primaryKey: "sale_id",
    headers: [
      "sale_id",
      "receipt_number",
      "customer_id",
      "transaction_date",
      "transaction_date_bs",
      "subtotal",
      "discount_amount",
      "total_amount",
      "status",
      "created_at",
      "updated_at",
    ],
    fields: [
      { name: "sale_id", type: "string", required: true, description: "UUID v4 primary key" },
      { name: "receipt_number", type: "string", required: true, description: "Human-readable receipt number (e.g. REC-20261025-0001)" },
      { name: "customer_id", type: "string", required: false, description: "Nullable UUID v4 reference to Customers sheet; null for walk-in" },
      { name: "transaction_date", type: "date", required: true, description: "Canonical Gregorian date YYYY-MM-DD for sorting/filtering" },
      { name: "transaction_date_bs", type: "string", required: true, description: "Preserved Bikram Sambat date (e.g. 2083-07-09)" },
      { name: "subtotal", type: "integer", required: true, isPaisaAmount: true, description: "Gross subtotal in Paisa" },
      { name: "discount_amount", type: "integer", required: true, isPaisaAmount: true, description: "Discount applied in Paisa (0 if none)" },
      { name: "total_amount", type: "integer", required: true, isPaisaAmount: true, description: "Net total in Paisa (subtotal - discount_amount)" },
      { name: "status", type: "string", required: true, allowedValues: ["draft", "completed", "cancelled", "refunded"], description: "Sale status" },
      { name: "created_at", type: "datetime", required: true, description: "ISO 8601 UTC creation timestamp" },
      { name: "updated_at", type: "datetime", required: true, description: "ISO 8601 UTC last update timestamp" },
    ],
  },
  {
    name: "SaleItems",
    description: "Line items belonging to each sale with price snapshots.",
    primaryKey: "sale_item_id",
    headers: [
      "sale_item_id",
      "sale_id",
      "product_id",
      "product_name_snapshot",
      "quantity",
      "unit_price_snapshot",
      "line_total",
    ],
    fields: [
      { name: "sale_item_id", type: "string", required: true, description: "UUID v4 primary key" },
      { name: "sale_id", type: "string", required: true, description: "Foreign key reference to Sales.sale_id" },
      { name: "product_id", type: "string", required: true, description: "Foreign key reference to Products.product_id" },
      { name: "product_name_snapshot", type: "string", required: true, description: "Product name at time of sale" },
      { name: "quantity", type: "number", required: true, description: "Quantity sold (integer or decimal for kg)" },
      { name: "unit_price_snapshot", type: "integer", required: true, isPaisaAmount: true, description: "Unit price at time of sale in Paisa" },
      { name: "line_total", type: "integer", required: true, isPaisaAmount: true, description: "Line total in Paisa (quantity * unit_price_snapshot)" },
    ],
  },
  {
    name: "Payments",
    description: "Payment records for cash, digital (eSewa), or credit settlement.",
    primaryKey: "payment_id",
    headers: [
      "payment_id",
      "sale_id",
      "customer_id",
      "payment_type",
      "payment_method",
      "amount",
      "payment_status",
      "provider_reference",
      "created_at",
      "updated_at",
    ],
    fields: [
      { name: "payment_id", type: "string", required: true, description: "UUID v4 primary key" },
      { name: "sale_id", type: "string", required: false, description: "Nullable foreign key reference to Sales.sale_id" },
      { name: "customer_id", type: "string", required: false, description: "Nullable foreign key reference to Customers.customer_id" },
      { name: "payment_type", type: "string", required: true, allowedValues: ["sale", "credit_repayment", "refund"], description: "Type of payment" },
      { name: "payment_method", type: "string", required: true, allowedValues: ["cash", "esewa", "credit"], description: "Payment channel" },
      { name: "amount", type: "integer", required: true, isPaisaAmount: true, description: "Payment amount in Paisa" },
      { name: "payment_status", type: "string", required: true, allowedValues: ["pending", "completed", "failed", "refunded"], description: "Payment status" },
      { name: "provider_reference", type: "string", required: false, description: "External reference ID (e.g. eSewa transaction code)" },
      { name: "created_at", type: "datetime", required: true, description: "ISO 8601 UTC creation timestamp" },
      { name: "updated_at", type: "datetime", required: true, description: "ISO 8601 UTC last update timestamp" },
    ],
  },
  {
    name: "Expenses",
    description: "Store operating expenses tracking.",
    primaryKey: "expense_id",
    headers: [
      "expense_id",
      "description",
      "category",
      "amount",
      "transaction_date",
      "transaction_date_bs",
      "created_at",
      "updated_at",
    ],
    fields: [
      { name: "expense_id", type: "string", required: true, description: "UUID v4 primary key" },
      { name: "description", type: "string", required: true, description: "Expense item description" },
      { name: "category", type: "string", required: true, description: "Expense category (e.g. rent, electricity, transport, supplies)" },
      { name: "amount", type: "integer", required: true, isPaisaAmount: true, description: "Expense amount in Paisa" },
      { name: "transaction_date", type: "date", required: true, description: "Canonical Gregorian date YYYY-MM-DD" },
      { name: "transaction_date_bs", type: "string", required: true, description: "Preserved Bikram Sambat date string" },
      { name: "created_at", type: "datetime", required: true, description: "ISO 8601 UTC creation timestamp" },
      { name: "updated_at", type: "datetime", required: true, description: "ISO 8601 UTC last update timestamp" },
    ],
  },
  {
    name: "AuditLog",
    description: "Audit trail for sensitive record modifications and system actions.",
    primaryKey: "audit_id",
    headers: [
      "audit_id",
      "actor_id",
      "action",
      "entity_type",
      "entity_id",
      "details",
      "created_at",
    ],
    fields: [
      { name: "audit_id", type: "string", required: true, description: "UUID v4 primary key" },
      { name: "actor_id", type: "string", required: false, description: "Actor identifier (nullable during foundation phase)" },
      { name: "action", type: "string", required: true, description: "Action code, e.g. CREATE, UPDATE, CANCEL, SCHEMA_INIT" },
      { name: "entity_type", type: "string", required: true, description: "Target entity, e.g. sale, customer, product, system" },
      { name: "entity_id", type: "string", required: true, description: "Identifier of the target entity" },
      { name: "details", type: "json", required: false, description: "JSON string containing action details or state diff" },
      { name: "created_at", type: "datetime", required: true, description: "ISO 8601 UTC creation timestamp" },
    ],
  },
  {
    name: "Settings",
    description: "Key-value configuration store for application settings.",
    primaryKey: "setting_key",
    headers: [
      "setting_key",
      "setting_value",
      "updated_at",
    ],
    fields: [
      { name: "setting_key", type: "string", required: true, description: "Unique configuration setting key" },
      { name: "setting_value", type: "string", required: true, description: "Configuration value string or JSON" },
      { name: "updated_at", type: "datetime", required: true, description: "ISO 8601 UTC last update timestamp" },
    ],
  },
  {
    name: "SystemTest",
    description: "Dedicated isolated sheet for verifying safe read and write backend operations without touching business data.",
    primaryKey: "test_id",
    headers: [
      "test_id",
      "message",
      "nonce",
      "created_at",
    ],
    fields: [
      { name: "test_id", type: "string", required: true, description: "UUID v4 test record identifier" },
      { name: "message", type: "string", required: true, description: "Test message payload" },
      { name: "nonce", type: "string", required: true, description: "Client nonce used for uniqueness check and duplicate rejection" },
      { name: "created_at", type: "datetime", required: true, description: "ISO 8601 UTC creation timestamp" },
    ],
  },
];

/**
 * Validates a sheet's headers against the expected canonical schema.
 * Missing headers: headers that exist in canonical schema but are absent in actual sheet.
 * Extra headers: headers that exist in actual sheet but are not defined in canonical schema.
 */
export function inspectHeaders(
  sheetName: SheetName,
  actualHeaders: readonly string[]
): Omit<SheetStatusReport, "rowCount" | "exists"> {
  const definition = DATABASE_SHEETS.find((s) => s.name === sheetName);
  if (!definition) {
    throw new Error(`Unknown sheet name: ${sheetName}`);
  }

  const normalizedActual = actualHeaders.map((h) => h.trim().toLowerCase());
  const expectedHeaders = definition.headers;

  const missingHeaders = expectedHeaders.filter(
    (h) => !normalizedActual.includes(h.toLowerCase())
  );
  const extraHeaders = actualHeaders.filter(
    (h) => !expectedHeaders.map((eh) => eh.toLowerCase()).includes(h.trim().toLowerCase())
  );

  let status: SheetStatusReport["status"] = "ok";
  if (actualHeaders.length === 0) {
    status = "empty_sheet";
  } else if (missingHeaders.length > 0) {
    status = "header_mismatch";
  }

  return {
    name: sheetName,
    status,
    expectedHeaders,
    actualHeaders,
    missingHeaders,
    extraHeaders,
  };
}
