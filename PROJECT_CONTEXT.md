# General Store Management System — Project Context

**Location:** `PROJECT_CONTEXT.md` (Repository Root)  
**Last Updated:** 2026-10-26  
**Status:** Living Context Document  

---

## 1. Project Purpose & Target Users

The **General Store Management System** is a lightweight, reliable, offline-tolerant point-of-sale (POS) and inventory management web application tailored for neighborhood general stores (kirana pasals) in Nepal.

### Intended Users
- **Store Owner / Operator**: Single authenticated administrative user running daily retail sales, tracking inventory, recording customer credit (Udhaar), recording supplier restocks, and inspecting financial reports.
- **Store Environment**: Desktop or tablet in a retail shop environment, frequently experiencing intermittent internet connectivity and mobile network latency.

---

## 2. Tech Stack & Architecture Overview

```
┌───────────────────────────────────────────────────────────┐
│                      Client Browser                       │
│  Next.js 16 App Router UI (React 19, Vanilla CSS, i18n)   │
└─────────────────────────────┬─────────────────────────────┘
                              │ HTTP / Cookies (Same-Origin)
┌─────────────────────────────▼─────────────────────────────┐
│                 Next.js Server (Node.js)                  │
│  - Session Guard & CSRF/Origin Validator                  │
│  - Pluggable Auth Storage (Memory / File / Upstash Redis) │
│  - Business Validation & Paisa Conversion Layer           │
│  - Apps Script Client Adapter (HMAC Authentication)       │
└─────────────────────────────┬─────────────────────────────┘
                              │ HMAC-SHA256 Authenticated HTTP POST
┌─────────────────────────────▼─────────────────────────────┐
│              Google Apps Script Web App Backend           │
│  - Token Verification & Timestamp Window Check            │
│  - LockService Script Mutex (withLock 15s)                │
│  - Idempotency Deduplication & Reconciler                 │
│  - Dynamic Header Mapping & Row Mutation                  │
└─────────────────────────────┬─────────────────────────────┘
                              │ Direct Spreadsheet API
┌─────────────────────────────▼─────────────────────────────┐
│              Google Sheets Database Engine                │
│  9 Core Sheets: Products, InventoryAdjustments, Customers,│
│  Sales, SaleItems, Payments, Expenses, AuditLog, Settings │
└───────────────────────────────────────────────────────────┘
```

### Technology Matrix
- **Frontend**: Next.js 16.4 (App Router, Webpack mode), React 19, TypeScript 5, Vanilla CSS with custom design tokens.
- **Backend / API**: Next.js Server Route Handlers (`/api/*`), Web Crypto HMAC-SHA256, Node.js `crypto`.
- **Database Engine**: Google Sheets operated via Google Apps Script Web App (`apps-script/src/`).
- **Local Dev / Testing**: `MockAppsScriptClient` with full in-memory spreadsheet simulation.
- **Session Storage**: Pluggable `AuthStorage` (`MemoryAuthStorage` for unit tests, `FileAuthStorage` for local multi-process, `UpstashRedisAuthStorage` for production).
- **Test Runner**: Node.js native test runner via `tsx --test tests/**/*.test.ts`.

---

## 3. Directory & Module Map

```
general-store/
├── apps-script/                 # Production Google Apps Script backend source
│   ├── appsscript.json          # Apps Script project manifest
│   ├── README.md                # Deployment and Script Properties setup guide
│   └── src/
│       ├── Config.js            # Canonical schemas and Script Properties reader
│       ├── Auth.js              # Shared secret verification and timestamp skew check
│       ├── Database.js          # LockService wrapper, UUID generator, header mapping
│       ├── Schema.js            # Header inspection and database initialization
│       ├── Handlers.js          # Business logic handlers (CRUD, idempotency, stock)
│       └── Code.js              # Web App doGet/doPost entrypoints
├── docs/                        # Architecture, specs, and persistent memory
│   ├── PROJECT_STATUS.md        # Primary task resume and implementation status
│   ├── PHASE_LOG.md             # Chronological phase history and verification log
│   ├── DECISIONS.md             # Architecture Decision Records (ADRs)
│   ├── database-schema.md       # Full sheet-by-sheet schema specifications
│   ├── product-management.md    # Product and inventory feature specifications
│   └── setup-and-deployment.md  # Production deployment instructions
├── src/
│   ├── app/                     # Next.js App Router
│   │   ├── (auth)/login/        # Login page
│   │   ├── (dashboard)/         # Protected dashboard pages (products, settings, etc.)
│   │   └── api/                 # Server routes (auth, products, system)
│   ├── components/              # React UI components
│   │   ├── products/            # Product view, forms, detail modal, stock adjust modal
│   │   ├── ui/                  # Icon, buttons, modal dialog primitives
│   │   └── app-shell.tsx        # Responsive dashboard layout and bilingual header
│   └── lib/
│       ├── i18n/                # Localization (en/ne) dictionary and provider
│       ├── money/               # Paisa <-> Rupee conversions and formatting
│       └── server/              # Server-only logic
│           ├── apps-script/     # Client, schemas, types, mock implementation
│           ├── auth/            # Hashing, tokens, session guards, storage adapters
│           └── products/        # Product and stock adjustment input validators
├── tests/                       # Automated test suite (tsx --test)
├── AGENTS.md                    # Antigravity IDE persistent agent instructions
├── PROJECT_CONTEXT.md           # This document
└── package.json                 # Scripts and dependencies
```

---

## 4. Business Requirements & Scope Boundaries

### In Scope
1. **Product Catalog**: Barcodes/SKU, categories, pricing, unit assignment, active/inactive status.
2. **Stock & Inventory**: Stock adjustments (`restock`, `damage`, `correction`, `set`), non-negative inventory enforcement, mandatory audit ledger, server-enforced idempotency.
3. **Point of Sale & Billing (Phase 7)**: Cart management, fast barcode/manual entry, point-in-time price snapshots, cash checkout, discount calculation.
4. **Customer Udhaar / Credit Ledger (Phase 8)**: Customer accounts, credit sales, partial repayment logging, outstanding balance tracking.
5. **Expense Tracking & Cash Register**: Daily operational cash reconciliation.
6. **Bilingual Localization**: Instant English (`en`) and Nepali (`ne`) switching.
7. **Dual Calendar**: ISO 8601 UTC timestamps alongside Nepali Bikram Sambat (BS) date strings.

### Strictly Out of Scope (Current Phases)
- Multi-branch inventory or multi-warehouse synchronization.
- Complex third-party payment gateways (eSewa / Khalti / dynamic Fonepay QR are **unconfirmed** and deferred until core POS and credit ledgers are complete).
- Public-facing consumer eCommerce ordering portal.
- Multi-tenant SaaS infrastructure (system is designed for single-store ownership).

---

## 5. Authentication & Security Architecture

1. **Single Owner Identity**: Store owner credentials stored server-side. Password verification uses scrypt (`N=16384, r=8, p=1`).
2. **Fail-Closed Security**: Missing configuration, empty secrets, or unreachable datastores reject all access immediately.
3. **Session Tokens**: Stateless HMAC-SHA256 signed JSON payloads carrying `sessionId`, `username`, `role: "owner"`, `createdAt`, `expiresAt`.
4. **Session Cookies**: In production, stored as `__Host-session`, `HttpOnly`, `SameSite=Lax`, `Secure`, `Path=/`.
5. **Durable Revocation & Rate Limiting**: All session revocations and login rate-limiting attempts persist in the configured `AuthStorage`.
6. **Cross-Origin Mutation Protection**: All mutating API routes (`POST`, `PATCH`, `DELETE`) require `isSameOriginRequest`, rejecting mismatched `Origin`, `Host`, and `Sec-Fetch-Site: cross-site`.
7. **Secrets Isolation**: No secret or credential environment variable begins with `NEXT_PUBLIC_`.

---

## 6. Data Integrity & Financial Conventions

1. **Strict Integer Paisa Convention**:
   - All monetary figures (`selling_price`, `cost_price`, `subtotal`, `discount_amount`, `total_amount`) are stored as minor units (**integer Paisa**), where **100 Paisa = 1 NPR**.
   - Floating-point arithmetic on currency is strictly prohibited.
2. **Stable Entity Identifiers**:
   - All entities use UUID v4 strings as primary keys (`product_id`, `adjustment_id`, `sale_id`, etc.).
   - Spreadsheet row numbers are never used as permanent record keys.
3. **Dynamic Sheet Header Mapping**:
   - Google Apps Script reads row 1 on every invocation to resolve `{ headerName: columnIndex }`. Rearranging or adding columns in Google Sheets will not corrupt data.
4. **Stock Adjustment Idempotency**:
   - Every stock adjustment requires a valid `idempotency_key`.
   - The backend checks for the key under `LockService` mutex. If already processed, it returns the cached record without double-mutating inventory.
   - **Self-Healing Reconciliation**: If a past write crashed after writing the ledger row but before updating product stock, replaying the idempotency key heals the product stock to `new_stock`.
5. **Unit Discretization**:
   - Discrete units (`piece`, `packet`, `bottle`) reject any fractional quantity.
   - Continuous units (`kg`, `gram`, `litre`, `metre`) allow up to 3 decimal places.
6. **Non-Negative Invariant**:
   - Inventory adjustments that would drop stock below zero are rejected with `VALIDATION_ERROR`.
7. **Soft Deactivation**:
   - Inactivating a product (`is_active: false`) preserves catalog rows, on-hand stock quantities, and historical audit entries.

---

## 7. Localization & Dual Date Handling

1. **Bilingual UI**:
   - Managed via [`src/lib/i18n/messages.ts`](file:///d:/1%20project/0codes/Project_neo/general-store/src/lib/i18n/messages.ts).
   - Supported languages: English (`en`) and Nepali (`ne`).
   - Persisted via cookie/localStorage with instant zero-refresh switching.
2. **Dual Date Storage**:
   - Every transaction records both Gregorian Date (`YYYY-MM-DD` in UTC) for unambiguous system sorting and date math, alongside Bikram Sambat date (`YYYY-MM-DD` in BS) for local merchant bookkeeping.

---

## 8. Deployment Architecture & Environment Variables

### Production Topology
- **Vercel / Node Server**: Hosts Next.js App Router application.
- **Google Apps Script**: Standalone Web App deployed as "Execute as: Me", "Who has access: Anyone". Secured via shared HMAC secret and short request age window (300,000 ms).
- **Upstash Redis**: Serverless Redis store for multi-instance distributed session revocation and brute-force lockout.

### Required Environment Variable Names (No Secrets Stored Here)
```
# Authentication
OWNER_USERNAME=
OWNER_PASSWORD_HASH=
SESSION_SECRET=
SESSION_EXPIRATION_SECONDS=

# Storage Selection
AUTH_STORAGE_TYPE=          # "redis" | "file" | "memory"
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Google Apps Script Backend
APPS_SCRIPT_URL=
APPS_SCRIPT_HMAC_SECRET=
APPS_SCRIPT_MODE=           # "live" | "mock"
ALLOW_TEST_WRITES=          # "true" | "false"
```

---

## 9. Key Limitations & Operational Constraints

1. **No Cross-Sheet ACID Transactions**: Google Sheets does not provide two-phase commit or rollbacks across sheets. The system mitigates this by writing immutable audit ledger records first, backed by idempotency self-healing reconciliation.
2. **Google Apps Script Concurrency**: Apps Script allows up to 30 simultaneous executions per Google account. Mutex locks use a 15-second timeout (`LockService.getScriptLock()`).
3. **Execution Redirects**: Apps Script Web Apps return HTTP 302 redirects to `script.googleusercontent.com`. HTTP clients must follow redirects.
