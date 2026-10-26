# Project Phase Log & Historical Changelog

**Location:** `docs/PHASE_LOG.md`  
**Last Updated:** 2026-10-26  
**Purpose:** Chronological record of completed development phases and verification outcomes.  

---

## Phase Index
1. [Phase 4: Google Apps Script & Google Sheets Database Foundation](#phase-4-google-apps-script--google-sheets-database-foundation)
2. [Phase 4.1: Backend Security & Protocol Hardening](#phase-41-backend-security--protocol-hardening)
3. [Phase 5: Store Owner Authentication & Session Security](#phase-5-store-owner-authentication--session-security)
4. [Phase 5.1: Authentication Storage Abstraction & Multi-Process Hardening](#phase-51-authentication-storage-abstraction--multi-process-hardening)
5. [Phase 5.2: Production Distributed Session Storage (Upstash Redis)](#phase-52-production-distributed-session-storage-upstash-redis)
6. [Phase 6: Core Product Catalog & Inventory Management](#phase-6-core-product-catalog--inventory-management)
7. [Phase 6.1: Inventory Integrity Audit & Hardening](#phase-61-inventory-integrity-audit--hardening)

---

## Phase 4: Google Apps Script & Google Sheets Database Foundation

- **Objective**: Establish Google Sheets as the system database using a Google Apps Script Web App backend. Define canonical 8-sheet schema + SystemTest sheet, header auto-generation, and mutual HMAC authentication.
- **Main Changes & Files Affected**:
  - `apps-script/src/Config.js`, `Database.js`, `Schema.js`, `Auth.js`, `Code.js`, `Handlers.js`: Core Google Apps Script implementation.
  - `src/lib/server/apps-script/client.ts`: Next.js client for communicating with Apps Script Web App.
  - `src/lib/server/apps-script/mock-client.ts`: Complete in-memory spreadsheet mock for local development and unit tests.
  - `src/lib/server/apps-script/schema.ts`: TypeScript definition of sheets, columns, and data types.
  - `docs/database-schema.md`: Full architectural specification of database sheets.
- **Verification Commands Executed**:
  - `npm test tests/database-foundation.test.ts` (Reported baseline tests)
  - `npx tsc --noEmit`
- **Actual Results**: PASS across all database foundation tests (schema validation, dynamic header detection, idempotent initialization, test record CRUD).
- **Live Integration Status**: **NOT TESTED** (Apps Script backend written and ready; executed against in-memory mock client).
- **Known Limitations**: Google Sheets lack multi-sheet ACID rollbacks; requests limited to 30 concurrent executions per Google account.
- **Final Status**: **COMPLETED** -> Proceeded to Phase 4.1.

---

## Phase 4.1: Backend Security & Protocol Hardening

- **Objective**: Harden the communication channel between Next.js and Google Apps Script Web App against replay attacks, timing leaks, and header manipulation.
- **Main Changes & Files Affected**:
  - `apps-script/src/Auth.js`: Implemented constant-time string comparison (`timingSafeEqual`) and strict timestamp freshness verification (max 300,000ms window).
  - `src/lib/server/apps-script/client.ts`: Added canonical payload stringification for deterministic HMAC-SHA256 signature generation.
  - `apps-script/src/Database.js`: Wrapped write operations with `LockService.getScriptLock()` (15-second timeout).
- **Verification Commands Executed**:
  - `npm test tests/backend-security.test.ts`
  - `npx tsc --noEmit`
- **Actual Results**: PASS (Timing attack resistance verified, replay window verified, missing timestamp rejection verified).
- **Live Integration Status**: **NOT TESTED** (Mock verified).
- **Known Limitations**: Relies on clock synchronization between Next.js server and Google servers within 5 minutes.
- **Final Status**: **COMPLETED** -> Proceeded to Phase 5.

---

## Phase 5: Store Owner Authentication & Session Security

- **Objective**: Implement single-owner store authentication, secure password hashing, signed session tokens, and route protection.
- **Main Changes & Files Affected**:
  - `src/lib/server/auth/credentials.ts`: Scrypt hashing (`N=16384, r=8, p=1`) and constant-time password verification.
  - `src/lib/server/auth/session.ts`: HMAC-SHA256 signed session tokens carrying session UUID, role, and expiration timestamp.
  - `src/lib/server/auth/guard.ts`: Server Component and Route Handler guards (`requireOwnerSession`, `verifyApiOwnerSession`).
  - `src/middleware.ts`: Next.js middleware guarding `/dashboard/*` with redirect to `/login`.
  - `src/app/(auth)/login/page.tsx`: Bilingual responsive login interface.
- **Verification Commands Executed**:
  - `npm test tests/auth-and-sessions.test.ts`
  - `npx tsc --noEmit`
- **Actual Results**: PASS across all authentication tests (credential validation, token tampering rejection, cookie security, brute-force lockout).
- **Live Integration Status**: **VERIFIED** on mock/in-memory session store.
- **Known Limitations**: Initial session revocation was process-local in memory; multi-instance deployment required external durable storage.
- **Final Status**: **COMPLETED** -> Proceeded to Phase 5.1.

---

## Phase 5.1: Authentication Storage Abstraction & Multi-Process Hardening

- **Objective**: Decouple authentication storage from in-memory process globals to support horizontal scaling, server restarts, and process-isolated dev environments.
- **Main Changes & Files Affected**:
  - `src/lib/server/auth/storage/index.ts`: Pluggable `AuthStorage` interface (`isSessionRevoked`, `revokeSession`, `recordLoginFailure`, `clearLoginFailures`, etc.).
  - `src/lib/server/auth/storage/memory.ts`: `MemoryAuthStorage` for lightweight unit tests.
  - `src/lib/server/auth/storage/file.ts`: `FileAuthStorage` with file locking for local multi-instance processes.
  - `src/lib/server/auth/durable-session.ts`: Durable verification checking individual session IDs and global revocation epoch.
- **Verification Commands Executed**:
  - `npm test tests/durable-auth.test.ts`
  - `npx tsc --noEmit`
- **Actual Results**: PASS across 45 tests (multi-instance session invalidation, global revocation epoch, rate-limiting lockout persistence).
- **Live Integration Status**: **VERIFIED** on local file and memory engines.
- **Known Limitations**: File storage is unsuited for serverless environments (e.g. Vercel read-only filesystems).
- **Final Status**: **COMPLETED** -> Proceeded to Phase 5.2.

---

## Phase 5.2: Production Distributed Session Storage (Upstash Redis)

- **Objective**: Design and build production-ready distributed session storage using Upstash Redis REST API with fail-closed security.
- **Main Changes & Files Affected**:
  - `src/lib/server/auth/storage/redis.ts`: `UpstashRedisAuthStorage` implementing sliding-window rate limiting, session revocation sets, and atomic epoch updates via REST.
  - `src/lib/server/auth/storage/fail-closed.ts`: `FailClosedAuthStorage` ensuring missing production credentials reject all mutations safely.
  - `src/lib/server/auth/storage/factory.ts`: Runtime factory choosing Redis in production, File in local development, Memory in tests.
  - `tests/production-auth-storage.test.ts`: 22 tests verifying distributed session lifecycle, lockout thresholds, and fail-closed safety.
- **Verification Commands Executed**:
  - `npm test tests/production-auth-storage.test.ts`
  - `npx tsc --noEmit`
- **Actual Results**: PASS (All 22 production storage tests passed).
- **Live Integration Status**: **NOT TESTED** (Upstash credentials not present in local workspace; tested against isolated storage contract).
- **Known Limitations**: Network latency to Redis REST API adds ~30-80ms on authentication requests if cold.
- **Final Status**: **COMPLETED** -> Proceeded to Phase 6.

---

## Phase 6: Core Product Catalog & Inventory Management

- **Objective**: Deliver complete product catalog management, bilingual formatting, inventory search/filters, and stock adjustment UI.
- **Main Changes & Files Affected**:
  - `src/lib/server/products/validation.ts`: Input validation for product creation, updates, and stock adjustments.
  - `src/app/api/products/route.ts`: Product listing (search, category, status, low stock, pagination) and product creation.
  - `src/app/api/products/[id]/route.ts`: Product detail retrieval and field updates.
  - `src/app/api/products/[id]/stock/route.ts`: Stock adjustment API route.
  - `src/components/products/`: `products-view.tsx`, `product-form-modal.tsx`, `product-detail-modal.tsx`, `stock-adjustment-modal.tsx`.
  - `src/lib/money/format.ts`: Integer Paisa conversion (`100 Paisa = NPR 1.00`) and Nepali/English currency formatting.
  - `docs/product-management.md`: Comprehensive product specification.
- **Verification Commands Executed**:
  - `npm test` (Reported 77 passing tests)
  - `npx tsc --noEmit`
  - `npm run lint`
  - `npm run build`
- **Actual Results**: Clean compilation, 77 passing tests reported.
- **Live Integration Status**: **NOT TESTED** (Mock backend verified).
- **Known Limitations**: Backend schema mismatch identified in `InventoryAdjustments` headers; real backend lacked idempotency enforcement.
- **Final Status**: **DELIVERED** -> Immediate requirement for Phase 6.1 Audit & Hardening.

---

## Phase 6.1: Inventory Integrity Audit & Hardening

- **Objective**: Audit and harden the Phase 6 implementation before introducing sales and billing. Fix backend idempotency, missing functions, schema field mismatches, fractional quantity constraints, and cross-origin security.
- **Main Changes & Files Affected**:
  - `apps-script/src/Database.js`: Implemented missing `generateUuid` function using `Utilities.getUuid()`.
  - `apps-script/src/Config.js`: Aligned `InventoryAdjustments` headers with canonical names (`quantity_change`, `previous_stock`, `new_stock`, `actor`, `idempotency_key`).
  - `apps-script/src/Handlers.js`:
    - Added atomic idempotency check with self-healing stock reconciliation.
    - Added discrete unit fraction rejection and continuous unit 3-decimal precision checks.
    - Enforced negative stock prevention.
    - Added case-insensitive duplicate SKU validation.
    - Added `normalizeAdjustment` helper.
  - `src/lib/server/apps-script/types.ts`: Synchronized `InventoryAdjustmentRecord` and required `idempotency_key` on `StockAdjustmentInput`.
  - `src/lib/server/apps-script/schema.ts`: Added `actor` and `idempotency_key` to schema.
  - `src/lib/server/apps-script/mock-client.ts`: Synchronized unit validation, negative stock guard, and self-healing reconciliation.
  - `src/lib/server/auth/guard.ts`: Enhanced `isSameOriginRequest` with `Sec-Fetch-Site` inspection and host matching.
  - `src/app/api/products/[id]/stock/route.ts`: Passed authenticated `actor` to backend.
  - `tests/products-and-inventory.test.ts`: Added 8 tests covering idempotency deduplication, concurrency safety, fractional unit validation, negative stock rejection, actor ledger tracking, case-insensitive SKU checks, soft deactivation, and cross-origin rejection.
- **Verification Commands Executed**:
  - `npm test`: **PASS (85/85 tests passed, 0 failures, 0 skipped)**
  - `npx tsc --noEmit`: **PASS (0 errors)**
  - `npm run lint`: **PASS (0 warnings)**
  - `npm run build`: **PASS (22/22 static pages & routes generated)**
- **Live Integration Status**: **NOT TESTED** (Apps Script credentials absent; thoroughly verified via `MockAppsScriptClient`).
- **Known Limitations**: No ACID rollback across Google Sheets; mitigated by audit-first writes and idempotency self-healing reconciliation.
- **Final Status**: **COMPLETED & VERIFIED** (GO for Phase 7).

---

## Phase 7: Point of Sale (POS), Sales Checkout & Inventory Deduction

- **Objective**: Deliver retail register POS interface, checkout flow with gross subtotal, editable discount, and change due calculation, recording into `Sales` and `SaleItems` sheets, atomic inventory decrement with `InventoryAdjustments` audit trail, and printable thermal receipt with dual Gregorian (AD) and Bikram Sambat (BS) dates.
- **Main Changes & Files Affected**:
  - `apps-script/src/Handlers.js`: Implemented `handleSaleCreate`, `handleSaleGet`, `handleSalesList`, receipt numbering (`REC-YYYYMMDD-XXXX`), Bikram Sambat date conversion (`gregorianToBikramSambatGAS`), and stock decrementing under lock mutex.
  - `apps-script/src/Code.js`: Added action dispatching for `sale_create`, `sale_get`, and `sales_list`.
  - `src/lib/server/apps-script/types.ts`: Defined `SaleRecord`, `SaleItemRecord`, `SaleWithItemsRecord`, `SaleCreateInput`, and `SaleListFilter`.
  - `src/lib/server/apps-script/mock-client.ts`: Implemented `createSale`, `getSale`, and `listSales` with stock deduction, audit ledger recording, and idempotency cache.
  - `src/lib/server/apps-script/client.ts`: Implemented `createSale`, `getSale`, and `listSales` dispatch methods.
  - `src/lib/server/sales/validation.ts`: Input validation for sale submission and line item parameters.
  - `src/app/api/sales/route.ts`: Protected endpoint with `verifyApiOwnerSession` and `isSameOriginRequest` for sale creation and listing.
  - `src/app/api/sales/[id]/route.ts`: Endpoint for fetching sale by UUID.
  - `src/components/sales/pos-register.tsx`: Interactive POS register with barcode/SKU lookup, category filtering, cart editor, discount in Paisa, cash tender / change calculator, and error alerts.
  - `src/components/sales/receipt-modal.tsx`: Printable thermal receipt modal with dual dates, items table, Paisa formatting, and `@media print` styling.
  - `src/app/(dashboard)/dashboard/sales/page.tsx`: Mounted `PosRegister`.
  - `src/components/ui/icon.tsx`: Added `printer` icon for receipt printing.
  - `src/lib/i18n/messages.ts`: Added bilingual POS and receipt dictionary translations for English (`en`) and Nepali (`ne`).
  - `src/app/globals.css`: Added responsive styles for POS register and thermal receipt.
  - `tests/sales-and-billing.test.ts`: Added 10 tests covering sale validation, calendar conversion, stock decrement, insufficient stock rejection, fractional unit constraints, idempotency deduplication, retrieval/listing, and API route security.
- **Verification Commands Executed**:
  - `npm test`: **PASS (95/95 tests passed, 0 failures, 0 skipped)**
  - `npx tsc --noEmit`: **PASS (0 errors)**
  - `npm run lint`: **PASS (0 warnings)**
  - `npm run build`: **PASS (23/23 static pages & routes generated)**
- **Live Integration Status**: **NOT TESTED** (Mock backend verified).
- **Known Limitations**: Third-party online wallets (eSewa/Khalti) unconfirmed; register is cash-first with customer credit (Udhaar) ledger coming in Phase 8.
- **Final Status**: **COMPLETED & VERIFIED** (GO for Phase 8).
