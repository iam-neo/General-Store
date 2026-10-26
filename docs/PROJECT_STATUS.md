# Project Implementation Status & Resume Guide

**Location:** `docs/PROJECT_STATUS.md`  
**Last Verified:** 2026-10-26 (Phase 7 Sales & Billing Completion)  
**Current Phase:** Phase 7 — **COMPLETED & VERIFIED**  
**Next Recommended Phase:** Phase 8 — **Customer Credit & Udhaar Ledger**  

---

## 1. Quick Resume Summary

To resume work on this repository without repeating audits:
1. Review this document ([`docs/PROJECT_STATUS.md`](file:///d:/1%20project/0codes/Project_neo/general-store/docs/PROJECT_STATUS.md)) and [`PROJECT_CONTEXT.md`](file:///d:/1%20project/0codes/Project_neo/general-store/PROJECT_CONTEXT.md).
2. Check recent decisions in [`docs/DECISIONS.md`](file:///d:/1%20project/0codes/Project_neo/general-store/docs/DECISIONS.md).
3. Verify test baseline by running `npm test` (all 95 tests should pass).
4. Proceed directly to the **Exact Next Task** defined in Section 7 of this document.

---

## 2. Milestone & Implementation State

| Phase | Title | Code State | Verification State | Live Backend State |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 4** | Apps Script & Sheets Foundation | Complete | `VERIFIED` (Mock Client) | `NOT TESTED` |
| **Phase 4.1** | Backend Security Review | Complete | `VERIFIED` (Tests & Code) | `NOT TESTED` |
| **Phase 5** | Store Owner Authentication | Complete | `VERIFIED` (Mock & File) | `NOT TESTED` |
| **Phase 5.1** | Auth Storage Abstraction | Complete | `VERIFIED` (Mock & File) | `NOT TESTED` |
| **Phase 5.2** | Production Redis Auth Adapter | Complete | `VERIFIED` (Mock Client) | `NOT TESTED` |
| **Phase 6** | Core Inventory & Product Management | Complete | `VERIFIED` (Unit & UI) | `NOT TESTED` |
| **Phase 6.1** | Inventory Integrity Audit & Hardening | Complete | `VERIFIED` (85/85 Tests) | `NOT TESTED` |
| **Phase 7** | Sales, Checkout & Billing | Complete | `VERIFIED` (95/95 Tests) | `NOT TESTED` |
| **Phase 8** | Customer Credit & Udhaar Ledger | Not Started | `PENDING` | `PENDING` |

---

## 3. Feature Matrix

### Completed & Verified Features (`VERIFIED` on Mock / Local)
- [x] **Store Owner Authentication**: Scrypt password hashing, HMAC-SHA256 session tokens, `__Host-session` HTTP-only cookie, brute-force sliding-window lockout.
- [x] **Durable Session Storage**: Multi-process revocation and rate limiting (`MemoryAuthStorage`, `FileAuthStorage`, `FailClosedAuthStorage`, `UpstashRedisAuthStorage`).
- [x] **Product Catalog Management**: Product creation, detail view, editing, case-insensitive duplicate SKU rejection, category filtering, search, low-stock threshold monitoring.
- [x] **Stock Adjustments & Ledger**: `restock`, `damage`, `correction`, `set`, and delta tracking in `InventoryAdjustments`.
- [x] **Stock Idempotency Engine**: Mandatory `idempotency_key` enforcement, duplicate submission deduplication, concurrent safety, self-healing stock reconciliation.
- [x] **Quantity Integrity**: Piece-based units (`piece`, `packet`, `bottle`) reject fractions; continuous units (`kg`, `litre`) allow up to 3 decimals; negative stock strictly blocked.
- [x] **Point of Sale (POS) Interface**: Interactive register (`/dashboard/sales`), barcode/SKU lookup, category filtering, quantity controls, line item calculations.
- [x] **Sales Checkout & Totals**: Subtotal, editable discount in Paisa/Rupees, net total, cash tendered, and real-time change due computation.
- [x] **Compound Sale Storage**: Atomic recording of header in `Sales` sheet and line items in `SaleItems` sheet with historical price snapshots.
- [x] **Atomic Stock Decrement**: Automatic product stock reduction upon checkout accompanied by audit entries in `InventoryAdjustments`.
- [x] **Printable Thermal Receipt**: Dual calendar date display (Gregorian ISO UTC and Nepali Bikram Sambat BS), itemized breakdown, and `@media print` thermal styling.
- [x] **Sale Idempotency & Durability**: Stable `idempotency_key` on sale creation preventing duplicate billing and double stock deductions on network retry, with server-authoritative catalog pricing (client overrides rejected).
- [x] **Compound Sale & Payment Storage**: Atomic recording of header in `Sales`, line items in `SaleItems` (with point-in-time price, SKU, and unit snapshots), and cash receipt in `Payments` sheet.
- [x] **POS Register UI & Sales History**: Bilingual tabbed interface (`/dashboard/sales`) with product search/filter, cart editor, checkout confirmation modal, cash-only notice badge, printable thermal receipt, and recent sales ledger inspection.
- [x] **API Route Security**: Route guards (`verifyApiOwnerSession` & `isSameOriginRequest`) on `/api/products*`, `/api/sales*`, and `/api/system*`.
- [x] **Financial Precision**: Integer Paisa representation (`100 Paisa = 1 NPR`) across all calculations and bilingual Rupee formatting (`रु` / `Rs.`).
- [x] **Bilingual Localization**: Seamless English (`en`) and Nepali (`ne`) UI translation dictionary and context provider.

### Pending Features (`PENDING`)
- [ ] **Customer Credit & Udhaar Ledger (Phase 8)**: Customer registry, credit sales linking, credit balance tracking, and partial cash repayments.
- [ ] **Transactions History (Phase 9)**: Searchable list and detail inspection of past sales, returns, and inventory adjustments.
- [ ] **Financial Reporting (Phase 10)**: Daily sales summaries, profit margin analytics, and expense tracking.

---

## 4. Latest Verification Command Results

**Execution Date:** 2026-10-26 13:30 NST  
**Environment:** Windows (PowerShell), Node.js v20+, Next.js 16.4.3  

| Check | Command | Result | Notes |
| :--- | :--- | :--- | :--- |
| **Unit & Integration Tests** | `npm test` | **PASS (98/98)** | 0 failures, 0 skipped, runtime ~2.2s (13 Phase 7 tests covering billing, pricing authority, snapshots, payments) |
| **TypeScript Typecheck** | `npx tsc --noEmit` | **PASS (0 errors)** | Strict types across Next.js, API routes, and mock client |
| **ESLint Static Analysis** | `npm run lint` | **PASS (0 warnings)** | Clean code style and React 19 hook hygiene |
| **Production Build** | `npm run build` | **PASS (0 errors)** | 23/23 static pages & dynamic API routes generated |

---

## 5. Live-vs-Mock Integration Status

- **Mock Implementation**: **VERIFIED**. `MockAppsScriptClient` replicates all 9 sheets, locking, idempotency cache, sales creation, and header inspection.
- **Live Google Sheets / Apps Script Backend**: **NOT TESTED**. No `.env.local` or live Google account credentials exist in the workspace.
- **Live Upstash Redis Storage**: **NOT TESTED**. Upstash credentials are not configured in local environment; local tests utilize `FileAuthStorage` and `MemoryAuthStorage`.
- **Policy Reminder**: Never mark live integration as verified unless real network calls against actual Google Apps Script deployments have executed successfully.

---

## 6. Known Bugs, Blockers & Open Technical Questions

1. **Open Technical Question: eSewa / Dynamic QR Integration**:
   - The user specification indicates online payment integration is **unconfirmed**.
   - Current architecture is strictly cash-first and credit (Udhaar)-first. Do not build online gateway integrations until explicitly requested and credentials provided.
2. **Google Sheets Execution Latency**:
   - Real Apps Script execution takes 800ms - 2500ms per mutating HTTP call. The POS checkout UI provides an active loading spinner and disables buttons during submission to prevent operator duplicate submissions.

---

## 7. Exact Next Recommended Task: Phase 8 (Customer Credit & Udhaar Ledger)

### Task Title
**Phase 8 — Customer Registry, Udhaar (Credit) Ledger & Repayment Tracking**

### Primary Objective
Implement the customer management module and credit (Udhaar) ledger enabling store owners to register neighborhood customers, track running credit balances, record credit-based sales, and log cash repayments with audit entries in the `Payments` sheet.

### Acceptance Criteria
1. **Customer Management (`/dashboard/customers`)**:
   - Customer listing with search by name/phone, credit status badge, and running balance.
   - Customer creation/editing modal (Name, Phone number, Address, Credit limit notes, Active status).
   - Validations: Name and valid phone format required; duplicate phone detection.
2. **Customer Credit Ledger & Balance Tracking**:
   - Backend tracking of running balance (calculated as `sum(Credit Sales) - sum(Repayments)`).
   - Dedicated customer detail view showing historical transaction timeline (credit sales and repayments).
3. **Credit Sale Workflow (`/dashboard/sales`)**:
   - Allow selecting a registered customer on POS register checkout when payment method is `credit`.
   - Record `customer_id` on the `Sales` header record and increment customer's outstanding balance.
4. **Repayment Entry**:
   - Repayment modal to record cash payments against outstanding Udhaar.
   - Append record to `Payments` sheet (`payment_id`, `customer_id`, `amount` in Paisa, `payment_date`, `payment_method: "cash"`, `notes`, `actor`).
   - Decrement customer's running balance accordingly.
5. **Automated Verification**:
   - Comprehensive test suite in `tests/customer-and-credit.test.ts` verifying customer CRUD, credit balance calculation, partial repayments, and API protection.

### Relevant Files & Modules
- [`src/lib/server/apps-script/types.ts`](file:///d:/1%20project/0codes/Project_neo/general-store/src/lib/server/apps-script/types.ts): Define `CustomerRecord`, `PaymentRecord`, `CustomerCreateInput`.
- [`apps-script/src/Handlers.js`](file:///d:/1%20project/0codes/Project_neo/general-store/apps-script/src/Handlers.js): Apps Script handlers for customer management and repayments.
- [`src/lib/server/apps-script/mock-client.ts`](file:///d:/1%20project/0codes/Project_neo/general-store/src/lib/server/apps-script/mock-client.ts): Implement customer and payment methods.
- [`src/app/api/customers/route.ts`](file:///d:/1%20project/0codes/Project_neo/general-store/src/app/api/customers/route.ts): Customer API routes.
- [`src/app/(dashboard)/dashboard/customers/page.tsx`](file:///d:/1%20project/0codes/Project_neo/general-store/src/app/(dashboard)/dashboard/customers/page.tsx): Customer management UI.
- [`src/app/(dashboard)/dashboard/credit/page.tsx`](file:///d:/1%20project/0codes/Project_neo/general-store/src/app/(dashboard)/dashboard/credit/page.tsx): Udhaar balance dashboard.
