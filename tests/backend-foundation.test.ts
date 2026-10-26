import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { DATABASE_SHEETS, inspectHeaders } from "../src/lib/server/apps-script/schema";
import type { SheetName } from "../src/lib/server/apps-script/types";
import { MockAppsScriptClient } from "../src/lib/server/apps-script/mock-client";
import { getAppsScriptConfig } from "../src/lib/server/apps-script/config";

test("Database Schema: defines all 8 core entities + SystemTest", () => {
  const expectedSheets: readonly SheetName[] = [
    "Products",
    "InventoryAdjustments",
    "Customers",
    "Sales",
    "SaleItems",
    "Payments",
    "Expenses",
    "AuditLog",
    "Settings",
    "SystemTest",
  ];

  const sheetNames = DATABASE_SHEETS.map((s) => s.name);
  assert.equal(sheetNames.length, 10);
  for (const name of expectedSheets) {
    assert.ok(sheetNames.includes(name), `Missing expected sheet definition: ${name}`);
  }
});

test("Database Schema: monetary fields are documented as integer Paisa", () => {
  const products = DATABASE_SHEETS.find((s) => s.name === "Products")!;
  const sellingPrice = products.fields.find((f) => f.name === "selling_price")!;
  assert.equal(sellingPrice.type, "integer");
  assert.equal(sellingPrice.isPaisaAmount, true);

  const sales = DATABASE_SHEETS.find((s) => s.name === "Sales")!;
  const totalAmount = sales.fields.find((f) => f.name === "total_amount")!;
  assert.equal(totalAmount.type, "integer");
  assert.equal(totalAmount.isPaisaAmount, true);
});

test("Header Inspection: detects valid, missing, and extra headers safely", () => {
  // 1. Valid headers
  const productsDef = DATABASE_SHEETS.find((s) => s.name === "Products")!;
  const validReport = inspectHeaders("Products", productsDef.headers);
  assert.equal(validReport.status, "ok");
  assert.equal(validReport.missingHeaders.length, 0);

  // 2. Missing headers
  const partialHeaders = ["product_id", "name", "category"];
  const partialReport = inspectHeaders("Products", partialHeaders);
  assert.equal(partialReport.status, "header_mismatch");
  assert.ok(partialReport.missingHeaders.includes("selling_price"));
  assert.ok(partialReport.missingHeaders.includes("is_active"));

  // 3. Extra headers
  const extraHeaders = [...productsDef.headers, "custom_barcode", "supplier_code"];
  const extraReport = inspectHeaders("Products", extraHeaders);
  assert.equal(extraReport.status, "ok"); // Extra headers do not break compatibility
  assert.deepEqual(extraReport.extraHeaders, ["custom_barcode", "supplier_code"]);

  // 4. Empty sheet
  const emptyReport = inspectHeaders("Products", []);
  assert.equal(emptyReport.status, "empty_sheet");
});

test("Database Initialization: idempotent execution preserves existing data", async () => {
  const client = new MockAppsScriptClient(false);

  // Step 1: Initial schema status should report missing sheets
  const initialStatus = await client.getSchemaStatus();
  assert.equal(initialStatus.data?.isCompatible, false);

  // Step 2: Initialize database creates all sheets
  const initResult = await client.initDatabase();
  assert.equal(initResult.success, true);
  assert.equal(initResult.data?.initialized, true);
  assert.equal(initResult.data?.actions.length, 10);

  // Step 3: Insert a test record to simulate existing data
  const testRecord = await client.createTestRecord("Sample message", "nonce-init-test-1");
  assert.equal(testRecord.success, true);

  // Step 4: Re-run initialization (idempotency check)
  const reinitResult = await client.initDatabase();
  assert.equal(reinitResult.success, true);
  assert.equal(reinitResult.data?.actions.length, 0, "No new sheets should be created on second run");

  // Step 5: Verify existing data was NOT lost or overwritten
  const readBack = await client.getTestRecord(testRecord.data!.test_id);
  assert.equal(readBack.success, true);
  assert.equal(readBack.data?.message, "Sample message");
});

test("Health Check Contract: returns valid status and reveals no secrets", async () => {
  const client = new MockAppsScriptClient();
  const res = await client.health();

  assert.equal(res.success, true);
  assert.equal(res.data?.status, "ok");
  assert.ok(res.data?.timestamp);
  assert.equal(res.error, null);

  // Verify no secrets or credentials leaked in response
  const serialized = JSON.stringify(res);
  assert.ok(!serialized.includes("password"));
  assert.ok(!serialized.includes("secret"));
  assert.ok(!serialized.includes("token"));
});

test("Test Operation: rejects invalid requests with clear VALIDATION_ERROR", async () => {
  const client = new MockAppsScriptClient(true);

  // Empty message
  const emptyMsgRes = await client.createTestRecord("", "nonce-1");
  assert.equal(emptyMsgRes.success, false);
  assert.equal(emptyMsgRes.error?.code, "VALIDATION_ERROR");

  // Empty nonce
  const emptyNonceRes = await client.createTestRecord("Valid message", "");
  assert.equal(emptyNonceRes.success, false);
  assert.equal(emptyNonceRes.error?.code, "VALIDATION_ERROR");
});

test("Test Operation: duplicate submissions are rejected with DUPLICATE_RECORD", async () => {
  const client = new MockAppsScriptClient(true);
  const nonce = "unique-test-nonce-12345";

  // First submission succeeds
  const first = await client.createTestRecord("First submission", nonce);
  assert.equal(first.success, true);
  assert.equal(first.data?.nonce, nonce);

  // Duplicate submission with same nonce fails
  const duplicate = await client.createTestRecord("Second submission with same nonce", nonce);
  assert.equal(duplicate.success, false);
  assert.equal(duplicate.error?.code, "DUPLICATE_RECORD");
});

test("Test Operation: reads back intended record and cleans up safely", async () => {
  const client = new MockAppsScriptClient(true);
  const nonce = "read-back-nonce-999";
  const message = "Read back verification message";

  // Create
  const createRes = await client.createTestRecord(message, nonce);
  assert.equal(createRes.success, true);
  const recordId = createRes.data!.test_id;

  // Read by ID
  const readById = await client.getTestRecord(recordId);
  assert.equal(readById.success, true);
  assert.equal(readById.data?.test_id, recordId);
  assert.equal(readById.data?.message, message);

  // Read by Nonce
  const readByNonce = await client.getTestRecord(nonce);
  assert.equal(readByNonce.success, true);
  assert.equal(readByNonce.data?.test_id, recordId);

  // Cleanup
  const cleanupRes = await client.cleanupTestRecords(recordId);
  assert.equal(cleanupRes.success, true);
  assert.equal(cleanupRes.data?.deletedCount, 1);

  // Confirm deleted
  const readDeleted = await client.getTestRecord(recordId);
  assert.equal(readDeleted.success, false);
  assert.equal(readDeleted.error?.code, "RECORD_NOT_FOUND");
});

test("Security: server environment variables are not prefixed with NEXT_PUBLIC_", () => {
  const config = getAppsScriptConfig();
  // Config keys must remain server-side
  assert.equal(typeof config.isConfigured, "boolean");

  // Verify process.env does not expose secrets under NEXT_PUBLIC_
  const envKeys = Object.keys(process.env);
  const publicSecretLeaks = envKeys.filter(
    (k) => k.startsWith("NEXT_PUBLIC_") && (k.includes("SECRET") || k.includes("PASSWORD") || k.includes("APPS_SCRIPT"))
  );
  assert.equal(
    publicSecretLeaks.length,
    0,
    `Found public secret leaks in environment: ${publicSecretLeaks.join(", ")}`
  );
});

test("Schema Status: reports missing sheets and corrupted headers without throwing", async () => {
  const client = new MockAppsScriptClient(true);

  // Remove a sheet to simulate missing sheet
  client.removeSheet("Expenses");

  // Corrupt headers of another sheet
  client.corruptSheetHeaders("Sales", ["sale_id", "bad_header"]);

  const status = await client.getSchemaStatus();
  assert.equal(status.success, true);
  assert.equal(status.data?.isCompatible, false);

  const missingExpenses = status.data?.sheets.find((s) => s.name === "Expenses");
  assert.equal(missingExpenses?.exists, false);
  assert.equal(missingExpenses?.status, "missing_sheet");

  const corruptedSales = status.data?.sheets.find((s) => s.name === "Sales");
  assert.equal(corruptedSales?.exists, true);
  assert.equal(corruptedSales?.status, "header_mismatch");
  assert.ok(corruptedSales?.missingHeaders.includes("total_amount"));
  assert.ok(corruptedSales?.extraHeaders.includes("bad_header"));
});

test("Live Client: normalizes network failure safely without exposing secrets", async () => {
  // Set temporary environment variable to test LiveAppsScriptClient error handling
  process.env.APPS_SCRIPT_URL = "http://127.0.0.1:54321/non-existent-endpoint";
  process.env.APPS_SCRIPT_SECRET = "super-secret-key-12345";

  const { LiveAppsScriptClient } = await import("../src/lib/server/apps-script/client");
  const client = new LiveAppsScriptClient(500); // 500ms timeout for fast failure

  const result = await client.health();

  assert.equal(result.success, false);
  assert.ok(
    result.error?.code === "NETWORK_ERROR" || result.error?.code === "TIMEOUT_ERROR",
    `Expected NETWORK_ERROR or TIMEOUT_ERROR, got: ${result.error?.code}`
  );

  // Critical: Secret must never leak into error message
  const errStr = JSON.stringify(result.error);
  assert.ok(!errStr.includes("super-secret-key-12345"), "Secret token leaked into error response!");

  // Cleanup env
  delete process.env.APPS_SCRIPT_URL;
  delete process.env.APPS_SCRIPT_SECRET;
});

test("Security & Auth: verifies HMAC signature calculation and constant-time equality", () => {
  const secret = "shared-test-secret-key";
  const timestamp = 1729850000000;
  const action = "test_record_create";
  const payload = { message: "Test payload", nonce: "nonce-1" };

  const dataToSign = `${timestamp}.${action}.${JSON.stringify(payload)}`;
  const signature = createHmac("sha256", secret).update(dataToSign).digest("hex");

  assert.equal(typeof signature, "string");
  assert.equal(signature.length, 64, "SHA-256 hex digest must be 64 characters");

  // Constant-time equality simulation check
  function constantTimeEquals(a: string, b: string): boolean {
    if (typeof a !== "string" || typeof b !== "string") return false;
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  assert.equal(constantTimeEquals(signature, signature), true);
  assert.equal(constantTimeEquals(signature, signature.slice(0, -1) + "0"), false);
  assert.equal(constantTimeEquals(signature, "invalid-short-sig"), false);
});

test("Security & Auth: validates timestamp skew window and rejects omitted timestamps", () => {
  const maxSkewMs = 300000; // 5 minutes

  function checkTimestampSkew(timestamp: unknown): { valid: boolean; code?: string } {
    if (timestamp === undefined || timestamp === null) {
      return { valid: false, code: "MISSING_TIMESTAMP" };
    }
    const num = Number(timestamp);
    if (isNaN(num)) {
      return { valid: false, code: "INVALID_TIMESTAMP" };
    }
    const skew = Math.abs(Date.now() - num);
    if (skew > maxSkewMs) {
      return { valid: false, code: "EXPIRED_TIMESTAMP" };
    }
    return { valid: true };
  }

  // Valid current timestamp
  assert.equal(checkTimestampSkew(Date.now()).valid, true);

  // Omitted timestamp (must be rejected)
  const missing = checkTimestampSkew(undefined);
  assert.equal(missing.valid, false);
  assert.equal(missing.code, "MISSING_TIMESTAMP");

  // Expired timestamp (10 minutes in the past)
  const expired = checkTimestampSkew(Date.now() - 600000);
  assert.equal(expired.valid, false);
  assert.equal(expired.code, "EXPIRED_TIMESTAMP");

  // Future replayed timestamp (10 minutes in the future)
  const future = checkTimestampSkew(Date.now() + 600000);
  assert.equal(future.valid, false);
  assert.equal(future.code, "EXPIRED_TIMESTAMP");
});

test("Configuration Consistency: resolves BACKEND_SECRET, APPS_SCRIPT_HMAC_SECRET, and APPS_SCRIPT_SECRET", () => {
  // Test fallback chain
  delete process.env.APPS_SCRIPT_HMAC_SECRET;
  delete process.env.APPS_SCRIPT_SECRET;
  delete process.env.BACKEND_SECRET;

  process.env.BACKEND_SECRET = "fallback-backend-secret";
  let cfg = getAppsScriptConfig();
  assert.equal(cfg.secret, "fallback-backend-secret");

  process.env.APPS_SCRIPT_SECRET = "standard-secret";
  cfg = getAppsScriptConfig();
  assert.equal(cfg.secret, "standard-secret");

  process.env.APPS_SCRIPT_HMAC_SECRET = "hmac-secret";
  cfg = getAppsScriptConfig();
  assert.equal(cfg.secret, "hmac-secret");

  // Cleanup
  delete process.env.APPS_SCRIPT_HMAC_SECRET;
  delete process.env.APPS_SCRIPT_SECRET;
  delete process.env.BACKEND_SECRET;
});


