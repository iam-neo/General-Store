/**
 * Configuration and Schema Definitions for Google Apps Script Backend.
 * General Store Management System — Phase 4 Foundation.
 */

var Config = (function () {
  var SCHEMA = [
    {
      name: "Products",
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
        "low_stock_threshold"
      ]
    },
    {
      name: "InventoryAdjustments",
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
        "created_at"
      ]
    },
    {
      name: "Customers",
      headers: [
        "customer_id",
        "name",
        "phone",
        "address",
        "notes",
        "is_active",
        "created_at",
        "updated_at"
      ]
    },
    {
      name: "Sales",
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
        "updated_at"
      ]
    },
    {
      name: "SaleItems",
      headers: [
        "sale_item_id",
        "sale_id",
        "product_id",
        "product_name_snapshot",
        "quantity",
        "unit_price_snapshot",
        "line_total"
      ]
    },
    {
      name: "Payments",
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
        "updated_at"
      ]
    },
    {
      name: "Expenses",
      headers: [
        "expense_id",
        "description",
        "category",
        "amount",
        "transaction_date",
        "transaction_date_bs",
        "created_at",
        "updated_at"
      ]
    },
    {
      name: "AuditLog",
      headers: [
        "audit_id",
        "actor_id",
        "action",
        "entity_type",
        "entity_id",
        "details",
        "created_at"
      ]
    },
    {
      name: "Settings",
      headers: [
        "setting_key",
        "setting_value",
        "updated_at"
      ]
    },
    {
      name: "SystemTest",
      headers: [
        "test_id",
        "message",
        "nonce",
        "created_at"
      ]
    }
  ];

  function getProperties() {
    return PropertiesService.getScriptProperties().getProperties() || {};
  }

  function get(key, defaultValue) {
    var props = getProperties();
    return props[key] !== undefined && props[key] !== "" ? props[key] : defaultValue;
  }

  return {
    SCHEMA: SCHEMA,
    getSpreadsheetId: function () {
      return get("SPREADSHEET_ID", "");
    },
    getBackendSecret: function () {
      return get("BACKEND_SECRET", "") || get("APPS_SCRIPT_HMAC_SECRET", "") || get("APPS_SCRIPT_SECRET", "");
    },
    isTestWriteAllowed: function () {
      return get("ALLOW_TEST_WRITES", "true") === "true";
    },
    getMaxRequestAgeMs: function () {
      return parseInt(get("MAX_REQUEST_AGE_MS", "300000"), 10); // 5 minutes
    }
  };
})();
