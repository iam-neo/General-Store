# Database Schema & Conventions (Phase 4 Foundation)

## 1. Architectural Overview

The General Store Management System uses **Google Sheets** as its structured database engine, operated through a **Google Apps Script Web App** backend.

All interactions adhere to the following strict architectural rules:
- **No Direct Browser Access**: Browsers and client components never access Google Sheets or Google Apps Script directly. All requests pass through Next.js server route handlers (`/api/system/*`).
- **Stable UUID Identifiers**: Every entity uses a stable UUID v4 identifier. Spreadsheet row numbers are **never** used as permanent record keys because sorting, filtering, or manual editing in Google Sheets changes row indices.
- **Dynamic Header Mapping**: Apps Script queries row 1 of each sheet dynamically to construct column mappings (`{ headerName: columnIndex }`). Writes and reads are mapped by field name, ensuring that column reordering in Google Sheets does not corrupt data.
- **Strict Money Convention (Integer Paisa)**: To prevent floating-point rounding errors common in JavaScript and spreadsheets, all monetary figures (`selling_price`, `cost_price`, `subtotal`, `discount_amount`, `total_amount`, `amount`, `line_total`) are stored as **integer minor units (Paisa)**, where **100 Paisa = 1 NPR**.
- **Canonical Timestamps & Dates**:
  - `created_at` and `updated_at` timestamps are stored in canonical **ISO 8601 UTC** (`YYYY-MM-DDTHH:mm:ss.sssZ`).
  - Transaction dates store both the canonical Gregorian date (`YYYY-MM-DD`) for deterministic sorting and date arithmetic, alongside the Nepali **Bikram Sambat (BS)** date string (`YYYY-MM-DD`) as recorded at time of transaction.
- **Concurrency & Locking**: All write operations acquire a `LockService.getScriptLock()` with a timeout and `try...finally` unlock to prevent concurrent write collisions.

---

## 2. Sheet Specifications

### 2.1 `Products`
Catalog of inventory items, units of measurement, and pricing.

| Column | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `product_id` | String (UUID) | Yes | Primary key |
| `name` | String | Yes | Item name (e.g. "बासमती चामल", "Malingo Tea 500g") |
| `category` | String | Yes | Category (e.g. "Grains", "Spices", "Dairy") |
| `unit` | String | Yes | Unit of measurement (e.g. "kg", "packet", "piece", "liter") |
| `selling_price` | Integer (Paisa) | Yes | Unit selling price in Paisa (10000 = NPR 100.00) |
| `cost_price` | Integer (Paisa) | No | Optional purchase/cost price in Paisa |
| `stock_quantity` | Number | No | Current on-hand quantity (integer or decimal for weighed goods) |
| `is_active` | Boolean | Yes | "TRUE" or "FALSE" flag indicating active sales eligibility |
| `created_at` | DateTime (ISO) | Yes | UTC creation timestamp |
| `updated_at` | DateTime (ISO) | Yes | UTC last modification timestamp |
| `sku` | String | No | Optional unique SKU or barcode |
| `opening_quantity` | Number | No | Initial stock quantity recorded when product was created |
| `low_stock_threshold` | Number | No | Low-stock warning threshold quantity (default: 5) |

### 2.2 `InventoryAdjustments`
Audit ledger of stock adjustments, restocks, damage write-offs, and count corrections.

| Column | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `adjustment_id` | String (UUID) | Yes | Primary key |
| `product_id` | String (UUID) | Yes | Foreign key -> `Products.product_id` |
| `adjustment_type` | String | Yes | `"set"`, `"increase"`, `"decrease"`, `"restock"`, `"damage"`, `"correction"` |
| `quantity_change` | Number | Yes | Quantity changed (delta or target quantity) |
| `previous_stock` | Number | Yes | On-hand quantity prior to adjustment |
| `new_stock` | Number | Yes | Resulting on-hand quantity |
| `reason` | String | Yes | Mandatory explanation for adjustment |
| `notes` | String | No | Optional additional notes or invoice references |
| `actor` | String | No | Operator username who performed the adjustment |
| `idempotency_key` | String | Yes | Client-provided idempotency key preventing duplicate adjustments |
| `created_at` | DateTime (ISO) | Yes | UTC creation timestamp |

### 2.3 `Customers`
Customer accounts for credit management (Udhaar) and contact info.

| Column | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `customer_id` | String (UUID) | Yes | Primary key |
| `name` | String | Yes | Customer full name |
| `phone` | String | Yes | Primary phone number (used for lookups and alerts) |
| `address` | String | No | Neighborhood / village / landmark |
| `notes` | String | No | Store notes (e.g. credit limit, repayment habits) |
| `is_active` | Boolean | Yes | "TRUE" or "FALSE" active status |
| `created_at` | DateTime (ISO) | Yes | UTC creation timestamp |
| `updated_at` | DateTime (ISO) | Yes | UTC last modification timestamp |

### 2.3 `Sales`
Header records for sales receipts and transactions.

| Column | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `sale_id` | String (UUID) | Yes | Primary key |
| `receipt_number` | String | Yes | Unique human-readable receipt (e.g. "REC-20261025-0001") |
| `customer_id` | String (UUID) | No | Nullable foreign key -> `Customers.customer_id` (null = walk-in) |
| `transaction_date` | Date (ISO) | Yes | Gregorian date `YYYY-MM-DD` |
| `transaction_date_bs`| String | Yes | Nepali Bikram Sambat date string (e.g. "2083-07-09") |
| `subtotal` | Integer (Paisa) | Yes | Gross subtotal in Paisa |
| `discount_amount` | Integer (Paisa) | Yes | Discount amount in Paisa |
| `total_amount` | Integer (Paisa) | Yes | Final payable amount in Paisa (`subtotal - discount_amount`) |
| `status` | String | Yes | Allowed: `"draft"`, `"completed"`, `"cancelled"`, `"refunded"` |
| `created_at` | DateTime (ISO) | Yes | UTC creation timestamp |
| `updated_at` | DateTime (ISO) | Yes | UTC last modification timestamp |

### 2.4 `SaleItems`
Line items associated with each sale, capturing point-in-time price snapshots.

| Column | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `sale_item_id` | String (UUID) | Yes | Primary key |
| `sale_id` | String (UUID) | Yes | Foreign key -> `Sales.sale_id` |
| `product_id` | String (UUID) | Yes | Foreign key -> `Products.product_id` |
| `product_name_snapshot` | String | Yes | Product name captured at time of sale |
| `quantity` | Number | Yes | Quantity purchased |
| `unit_price_snapshot` | Integer (Paisa) | Yes | Unit price at time of sale in Paisa |
| `line_total` | Integer (Paisa) | Yes | Total in Paisa (`quantity * unit_price_snapshot`) |

### 2.5 `Payments`
Payment events against sales or customer credit repayments.

| Column | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `payment_id` | String (UUID) | Yes | Primary key |
| `sale_id` | String (UUID) | No | Nullable foreign key -> `Sales.sale_id` |
| `customer_id` | String (UUID) | No | Nullable foreign key -> `Customers.customer_id` |
| `payment_type` | String | Yes | Allowed: `"sale"`, `"credit_repayment"`, `"refund"` |
| `payment_method` | String | Yes | Allowed: `"cash"`, `"esewa"`, `"credit"` |
| `amount` | Integer (Paisa) | Yes | Amount paid in Paisa |
| `payment_status` | String | Yes | Allowed: `"pending"`, `"completed"`, `"failed"`, `"refunded"` |
| `provider_reference`| String | No | External reference (e.g. eSewa transaction ID) |
| `created_at` | DateTime (ISO) | Yes | UTC creation timestamp |
| `updated_at` | DateTime (ISO) | Yes | UTC last modification timestamp |

### 2.6 `Expenses`
Daily operational store expenses.

| Column | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `expense_id` | String (UUID) | Yes | Primary key |
| `description` | String | Yes | Purpose of expense (e.g. "Electricity bill", "Shop rent") |
| `category` | String | Yes | Category (e.g. "rent", "electricity", "transport", "supplies") |
| `amount` | Integer (Paisa) | Yes | Amount in Paisa |
| `transaction_date` | Date (ISO) | Yes | Gregorian date `YYYY-MM-DD` |
| `transaction_date_bs`| String | Yes | Nepali Bikram Sambat date string |
| `created_at` | DateTime (ISO) | Yes | UTC creation timestamp |
| `updated_at` | DateTime (ISO) | Yes | UTC last modification timestamp |

### 2.7 `AuditLog`
Immutable audit trail of administrative actions.

| Column | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `audit_id` | String (UUID) | Yes | Primary key |
| `actor_id` | String | No | Operator identifier (nullable in foundation phase) |
| `action` | String | Yes | Action code (`"CREATE"`, `"UPDATE"`, `"CANCEL"`, `"SCHEMA_INIT"`) |
| `entity_type` | String | Yes | Entity name (`"sale"`, `"customer"`, `"product"`, `"system"`) |
| `entity_id` | String | Yes | Identifier of modified entity |
| `details` | String (JSON) | No | Serialized change context or diff |
| `created_at` | DateTime (ISO) | Yes | UTC creation timestamp |

### 2.8 `Settings`
Key-value store for application settings and metadata.

| Column | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `setting_key` | String | Yes | Primary key setting identifier |
| `setting_value` | String | Yes | Serialized value or configuration payload |
| `updated_at` | DateTime (ISO) | Yes | UTC last modification timestamp |

### 2.9 `SystemTest`
Dedicated isolated sheet for verifying safe read/write connectivity during development and diagnostics. **Never touches or pollutes production business records.**

| Column | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `test_id` | String (UUID) | Yes | Primary key |
| `message` | String | Yes | Verification message payload |
| `nonce` | String | Yes | Unique nonce ensuring idempotent test submissions |
| `created_at` | DateTime (ISO) | Yes | UTC creation timestamp |

---

## 3. Idempotent Database Initialization

The initialization function (`Schema.initializeDatabase()` in Apps Script and `POST /api/system/init-database`):
1. Acquires a script lock to prevent concurrent initialization.
2. Checks for each of the 9 defined sheets.
3. If a sheet does not exist, creates it, adds bold headers in row 1, and freezes row 1.
4. If a sheet exists:
   - If empty (0 rows / 0 columns), inserts the expected headers.
   - If populated, compares existing headers against expected headers. Any missing columns are safely appended to the right side of row 1 without clearing, overwriting, or modifying any existing data.
5. Returns a structured `SchemaStatusResult` reporting compatibility and record counts.
