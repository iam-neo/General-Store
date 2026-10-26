# Architecture & Business Decision Records (ADRs)

**Location:** `docs/DECISIONS.md`  
**Last Updated:** 2026-10-26  
**Purpose:** Durable record of technical, architectural, and business decisions guiding current and future development.  

---

## Index of Decisions
- [ADR-001: Google Sheets Database Driven via Google Apps Script Web App](#adr-001-google-sheets-database-driven-via-google-apps-script-web-app)
- [ADR-002: Integer Minor Units (Paisa) for all Financial Values](#adr-002-integer-minor-units-paisa-for-all-financial-values)
- [ADR-003: Stable UUID Identifiers over Spreadsheet Row Numbers](#adr-003-stable-uuid-identifiers-over-spreadsheet-row-numbers)
- [ADR-004: Dynamic Sheet Column Mapping via Row 1 Inspection](#adr-004-dynamic-sheet-column-mapping-via-row-1-inspection)
- [ADR-005: Server-Only Single Owner Authentication (Fail-Closed)](#adr-005-server-only-single-owner-authentication-fail-closed)
- [ADR-006: Server-Enforced Stock Adjustment Idempotency & Reconciliation](#adr-006-server-enforced-stock-adjustment-idempotency--reconciliation)
- [ADR-007: Pluggable Durable Authentication Storage Engine](#adr-007-pluggable-durable-authentication-storage-engine)
- [ADR-008: Dual Calendar Date Storage (ISO UTC + Bikram Sambat BS)](#adr-008-dual-calendar-date-storage-iso-utc--bikram-sambat-bs)
- [ADR-009: Strict Cross-Origin Mutation & Session Guarding](#adr-009-strict-cross-origin-mutation--session-guarding)
- [ADR-010: Third-Party Online Payments (eSewa / Khalti / Dynamic QR) Deferred & Unconfirmed](#adr-010-third-party-online-payments-esewa--khalti--dynamic-qr-deferred--unconfirmed)
- [ADR-011: POS Atomic Checkout, Historical Price Snapshotting & Stock Decrement](#adr-011-pos-atomic-checkout-historical-price-snapshotting--stock-decrement)

---

### ADR-001: Google Sheets Database Driven via Google Apps Script Web App
- **Status:** **FINAL**
- **Decision:** Use Google Sheets as the persistent datastore for the General Store Management System, accessed exclusively via a server-to-server Google Apps Script Web App endpoint authenticated with HMAC-SHA256 signatures.
- **Why Chosen:** Local kirana store owners are already familiar with Google Sheets. It gives owners raw visibility, transparent data ownership, and free automated cloud backup without requiring PostgreSQL/MySQL cloud hosting costs.
- **Constraints:**
  - Google Apps Script enforces a 30-concurrent-execution quota.
  - Apps Script Web Apps return HTTP 302 redirects.
  - Latency is higher than traditional SQL databases (800ms - 2500ms per round trip).
- **Consequences & Limitations:** Google Sheets does **not** support multi-sheet ACID rollbacks. Application logic must write immutable audit ledger rows first, and enforce idempotency self-healing reconciliation to handle partial network drops.

---

### ADR-002: Integer Minor Units (Paisa) for all Financial Values
- **Status:** **FINAL**
- **Decision:** Store and compute all monetary values (`selling_price`, `cost_price`, `subtotal`, `discount_amount`, `total_amount`, `line_total`, `amount`) strictly as 64-bit integers in **Paisa** (where `100 Paisa = 1 NPR`).
- **Why Chosen:** Floating-point representations (`float` / `double`) introduce catastrophic rounding anomalies (e.g. `0.1 + 0.2 = 0.30000000000000004`) in billing, receipts, discounts, and ledger reconciliation.
- **Constraints:** All calculations (line totals, tax, discounts) must use integer arithmetic (e.g. `Math.round()`).
- **Consequences & Limitations:** User inputs in Rupees must be converted to Paisa at the boundary using `rupeesToPaisa()`. Frontend display formatting must use `formatPaisa()` or `paisaToRupees()`. Decimal currency fields are banned in schemas.

---

### ADR-003: Stable UUID Identifiers over Spreadsheet Row Numbers
- **Status:** **FINAL**
- **Decision:** Every entity must be identified by a stable UUID v4 (`product_id`, `adjustment_id`, `sale_id`, `sale_item_id`, `customer_id`, `payment_id`). Spreadsheet row indices (`row 2`, `row 15`) must never be used as foreign keys or permanent references.
- **Why Chosen:** Spreadsheet rows change dynamically when users filter, sort, delete, or manually reorder rows in the Google Sheets web interface.
- **Constraints:** Lookups must match by the UUID column, never by row offset.
- **Consequences & Limitations:** O(N) sheet row scanning is required in Apps Script. Mitigated by caching row values in memory during script execution.

---

### ADR-004: Dynamic Sheet Column Mapping via Row 1 Inspection
- **Status:** **FINAL**
- **Decision:** Google Apps Script backend dynamically reads Row 1 on each execution to construct a `{ [headerName]: columnIndex }` map before writing or reading records.
- **Why Chosen:** Store owners occasionally insert notes columns, rearrange column display order, or change sheet formatting directly in Google Sheets. Hardcoded column offsets (`col[2]`) lead to silent data corruption.
- **Constraints:** Column headers in Row 1 must match the canonical schema names exactly.
- **Consequences & Limitations:** Modest CPU overhead in Apps Script to inspect headers, completely outweighed by data corruption prevention.

---

### ADR-005: Server-Only Single Owner Authentication (Fail-Closed)
- **Status:** **FINAL**
- **Decision:** Enforce single-owner authentication verified exclusively on the server. Scrypt password hashing is used with an HMAC-SHA256 session token stored in an `HttpOnly`, `SameSite=Lax`, `Secure` cookie. If configuration or secrets are missing, the system **fails closed** (rejects all requests).
- **Why Chosen:** Kirana stores are operated by the owner or immediate family. Single-owner identity eliminates multi-tenant attack vectors while maintaining high security.
- **Constraints:**
  - Client components must never access secrets or backend credentials (strictly no `NEXT_PUBLIC_` prefix on secrets).
  - Credentials must not be committed to Git.
- **Consequences & Limitations:** Unauthenticated requests receive 401 Unauthorized immediately at route boundaries.

---

### ADR-006: Server-Enforced Stock Adjustment Idempotency & Reconciliation
- **Status:** **FINAL**
- **Decision:** Every inventory adjustment requires a mandatory client-generated `idempotency_key`. The Apps Script backend queries the `InventoryAdjustments` sheet under `LockService` mutex. If the key exists, it returns the previous record without reapplying the stock delta.
- **Why Chosen:** Store operators frequently click buttons multiple times or experience flaky mobile broadband. Duplicate submissions would double-deduct or double-restock inventory.
- **Self-Healing Reconciliation:** If a previous run was interrupted after appending to `InventoryAdjustments` but before updating the `Products` sheet, a subsequent retry with the same idempotency key detects that `product.stock_quantity !== adjustment.new_stock` and automatically reconciles the product stock.
- **Consequences & Limitations:** All client modals and API callers must supply an idempotency key.

---

### ADR-007: Pluggable Durable Authentication Storage Engine
- **Status:** **FINAL**
- **Decision:** Provide a pluggable `AuthStorage` interface supporting three implementations:
  1. `MemoryAuthStorage`: For fast, isolated unit tests.
  2. `FileAuthStorage`: For local multi-process dev and testing across instances without cloud services.
  3. `UpstashRedisAuthStorage`: For distributed production deployments (e.g. Vercel serverless).
- **Why Chosen:** In-memory maps cannot share revocations across serverless functions or horizontally scaled containers.
- **Constraints:** In production (`NODE_ENV=production`), `FileAuthStorage` and `MemoryAuthStorage` are refused unless explicitly overridden. If Redis credentials are missing in production, `FailClosedAuthStorage` rejects all mutations.
- **Consequences & Limitations:** Requires Upstash Redis configuration for live production deployments.

---

### ADR-008: Dual Calendar Date Storage (ISO UTC + Bikram Sambat BS)
- **Status:** **FINAL**
- **Decision:** Store both ISO 8601 UTC dates/timestamps (`YYYY-MM-DD` / `YYYY-MM-DDTHH:mm:ss.sssZ`) and Nepali Bikram Sambat date strings (`YYYY-MM-DD`) on all transaction records (`Sales`, `Payments`, `Expenses`).
- **Why Chosen:** Commercial billing and tax reporting in Nepal operate on the Bikram Sambat calendar (e.g. 2083 BS). System date arithmetic, sorting, and database queries require Gregorian ISO timestamps to remain deterministic.
- **Constraints:** Both formats must be calculated and recorded at transaction creation time.
- **Consequences & Limitations:** Eliminates runtime timezone and calendar conversion bugs during historical ledger exports.

---

### ADR-009: Strict Cross-Origin Mutation & Session Guarding
- **Status:** **FINAL**
- **Decision:** All mutating API endpoints (`POST`, `PATCH`, `DELETE`) require both valid session authorization and verification via `isSameOriginRequest`. Requests with `Sec-Fetch-Site: cross-site` or mismatched `Origin` / `Host` headers are rejected with 403 Forbidden.
- **Why Chosen:** Protects authenticated store owner sessions against Cross-Site Request Forgery (CSRF) and cross-origin phishing injections.
- **Constraints:** Non-browser automated test requests must preserve host integrity or use authenticated server contexts.

---

### ADR-010: Third-Party Online Payments (eSewa / Khalti / Dynamic QR) Deferred & Unconfirmed
- **Status:** **UNDER INVESTIGATION (UNCONFIRMED)**
- **Decision:** Online digital wallets (eSewa, Khalti, dynamic Fonepay QR) are explicitly deferred and marked **UNCONFIRMED**. The system design is cash-first and credit (Udhaar)-first.
- **Why Chosen:** Integrating third-party payment gateways requires merchant bank credentials, static vs dynamic merchant agreements, and webhook callbacks incompatible with private serverless environments. Core POS and Udhaar credit ledgers must be verified first.
- **Constraints:** Do not write code or assume eSewa API availability until merchant credentials and formal integration requirements are provided.

---

### ADR-011: POS Atomic Checkout, Historical Price Snapshotting & Stock Decrement
- **Status:** **FINAL**
- **Decision:** POS register checkout (`POST /api/sales`) executes as an atomic compound mutation:
  1. Validates available stock and unit precision for all items.
  2. Enforces **server-authoritative pricing**: catalog `selling_price` is strictly resolved on the server; client-supplied price overrides are rejected/ignored to prevent manipulation.
  3. Generates a human-readable sequence receipt number (`REC-YYYYMMDD-XXXX`).
  4. Captures dual calendar dates (Gregorian ISO and Bikram Sambat BS).
  5. Snapshots product name, barcode/SKU (`sku_snapshot`), and unit (`unit_snapshot`) alongside unit price into `SaleItems` to guarantee financial ledger integrity when catalog prices or units change in the future.
  6. Atomically writes audit records to `InventoryAdjustments` (`reason: "Sale REC-..."`) and decrements product inventory.
  7. Appends a cash receipt to `Payments` sheet (`payment_type: "sale"`, `payment_method: "cash"`, `payment_status: "completed"`).
  8. Transitions sale status from `pending` to `completed` once all children sheets are written.
  9. Enforces client-provided `idempotency_key` so network timeouts or re-submissions return the cached sale without duplicate stock deductions.
- **Why Chosen:** Prevents stock desynchronization and ensures thermal receipts, payments ledger, and sales records remain historically unalterable regardless of subsequent product edits or price inflation.
- **Constraints:** Sale items must not exceed on-hand stock quantities at time of checkout. Only cash payments are allowed in Phase 7 (credit/Udhaar deferred to Phase 8).
- **Consequences & Limitations:** Google Sheets does not support multi-sheet ACID rollbacks; ordering writes audit-first and caching idempotency keys ensures self-healing consistency across client retries.
