/**
 * Database schema and API contract types for General Store Management Backend.
 * Phase 4 — Google Apps Script Backend & Google Sheets Database.
 */

export type SheetName =
  | "Products"
  | "InventoryAdjustments"
  | "Customers"
  | "Sales"
  | "SaleItems"
  | "Payments"
  | "Expenses"
  | "AuditLog"
  | "Settings"
  | "SystemTest";

export type ProductUnit =
  | "piece"
  | "packet"
  | "bottle"
  | "kg"
  | "gram"
  | "litre"
  | "metre";

export const PRODUCT_UNITS: readonly ProductUnit[] = [
  "piece",
  "packet",
  "bottle",
  "kg",
  "gram",
  "litre",
  "metre",
];

export type ProductRecord = Readonly<{
  product_id: string;
  name: string;
  sku?: string | null;
  category: string;
  unit: ProductUnit | string;
  selling_price: number; // integer paisa (1 NPR = 100 Paisa)
  cost_price?: number | null; // integer paisa (1 NPR = 100 Paisa)
  stock_quantity: number;
  opening_quantity: number;
  low_stock_threshold: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}>;

export type InventoryAdjustmentRecord = Readonly<{
  adjustment_id: string;
  product_id: string;
  adjustment_type: "set" | "increase" | "decrease" | "restock" | "damage" | "correction";
  quantity_change: number;
  previous_stock: number;
  new_stock: number;
  reason: string;
  notes?: string | null;
  actor?: string | null;
  idempotency_key?: string | null;
  created_at: string;
}>;

export type ProductCreateInput = Readonly<{
  name: string;
  sku?: string | null;
  category: string;
  unit: string;
  selling_price: number; // integer paisa
  cost_price?: number | null; // integer paisa
  opening_quantity?: number;
  low_stock_threshold?: number;
  is_active?: boolean;
  idempotency_key?: string;
}>;

export type ProductUpdateInput = Readonly<{
  name?: string;
  sku?: string | null;
  category?: string;
  unit?: string;
  selling_price?: number; // integer paisa
  cost_price?: number | null; // integer paisa
  low_stock_threshold?: number;
  is_active?: boolean;
}>;

export type StockAdjustmentInput = Readonly<{
  adjustment_type: "set" | "increase" | "decrease" | "restock" | "damage" | "correction";
  quantity: number; // change amount or absolute amount
  reason: string;
  notes?: string | null;
  actor?: string | null;
  idempotency_key: string;
}>;

export type ProductListFilter = Readonly<{
  search?: string;
  category?: string;
  status?: "all" | "active" | "inactive";
  low_stock?: boolean;
  page?: number;
  limit?: number;
}>;

export type ProductSummaryStats = Readonly<{
  totalCount: number;
  activeCount: number;
  inactiveCount: number;
  lowStockCount: number;
  outOfStockCount: number;
}>;

export type ProductListResult = Readonly<{
  products: readonly ProductRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  categories: readonly string[];
  summary: ProductSummaryStats;
}>;

export type FieldType = "string" | "number" | "integer" | "boolean" | "date" | "datetime" | "json";

export type FieldDefinition = Readonly<{
  name: string;
  type: FieldType;
  required: boolean;
  description: string;
  allowedValues?: readonly string[];
  isPaisaAmount?: boolean;
}>;

export type SheetDefinition = Readonly<{
  name: SheetName;
  description: string;
  primaryKey: string;
  headers: readonly string[];
  fields: readonly FieldDefinition[];
}>;

export type SheetInspectionStatus = "ok" | "missing_sheet" | "header_mismatch" | "empty_sheet";

export type SheetStatusReport = Readonly<{
  name: SheetName;
  exists: boolean;
  status: SheetInspectionStatus;
  expectedHeaders: readonly string[];
  actualHeaders: readonly string[];
  missingHeaders: readonly string[];
  extraHeaders: readonly string[];
  rowCount: number;
}>;

export type SchemaStatusResult = Readonly<{
  isCompatible: boolean;
  sheets: readonly SheetStatusReport[];
  checkedAt: string;
}>;

export type DatabaseInitResult = Readonly<{
  initialized: boolean;
  actions: readonly string[];
  schemaStatus: SchemaStatusResult;
  timestamp: string;
}>;

export type HealthCheckResult = Readonly<{
  status: "ok" | "degraded" | "error";
  timestamp: string;
  version: string;
  backend: "google-apps-script" | "mock-apps-script";
  environment?: string;
}>;

export type SystemTestRecord = Readonly<{
  test_id: string;
  message: string;
  nonce: string;
  created_at: string;
}>;

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR"
  | "DUPLICATE_RECORD"
  | "RECORD_NOT_FOUND"
  | "DATABASE_NOT_CONFIGURED"
  | "SCHEMA_MISMATCH"
  | "NETWORK_ERROR"
  | "TIMEOUT_ERROR"
  | "UPSTREAM_ERROR"
  | "TEST_WRITE_DISABLED"
  | "INTERNAL_ERROR";

export type PaymentRecord = Readonly<{
  payment_id: string;
  sale_id?: string | null;
  customer_id?: string | null;
  payment_type: "sale" | "credit_repayment" | "refund";
  payment_method: "cash" | "esewa" | "credit";
  amount: number; // integer paisa
  payment_status: "pending" | "completed" | "failed" | "refunded";
  provider_reference?: string | null;
  created_at: string;
  updated_at: string;
}>;

export type SaleRecord = Readonly<{
  sale_id: string;
  receipt_number: string;
  customer_id?: string | null;
  transaction_date: string;
  transaction_date_bs: string;
  subtotal: number; // integer paisa
  discount_amount: number; // integer paisa
  total_amount: number; // integer paisa
  status: "draft" | "completed" | "cancelled" | "refunded" | "pending" | "failed";
  payment_method: "cash" | "credit" | "other";
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}>;

export type SaleItemRecord = Readonly<{
  sale_item_id: string;
  sale_id: string;
  product_id: string;
  product_name_snapshot: string;
  sku_snapshot?: string | null;
  unit_snapshot: string;
  quantity: number;
  unit_price_snapshot: number; // integer paisa
  line_total: number; // integer paisa
}>;

export type SaleWithItemsRecord = Readonly<{
  sale: SaleRecord;
  items: readonly SaleItemRecord[];
  payment?: PaymentRecord | null;
}>;

export type SaleCreateItemInput = Readonly<{
  product_id: string;
  quantity: number;
  unit_price_snapshot?: number | null; // Optional; server enforces catalog selling_price
}>;

export type SaleCreateInput = Readonly<{
  customer_id?: string | null;
  items: readonly SaleCreateItemInput[];
  discount_amount?: number; // integer paisa
  idempotency_key: string;
  payment_method?: "cash" | "credit" | "other";
  actor?: string | null;
}>;

export type SaleListFilter = Readonly<{
  start_date?: string;
  end_date?: string;
  customer_id?: string;
  status?: string;
  page?: number;
  limit?: number;
}>;

export type ApiError = Readonly<{
  code: ApiErrorCode;
  message: string;
  details?: unknown;
}>;

export type ApiResponse<T> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: ApiError };

export type AppsScriptAction =
  | "health"
  | "schema_status"
  | "init_database"
  | "test_record_create"
  | "test_record_get"
  | "test_record_cleanup"
  | "products_list"
  | "product_create"
  | "product_get"
  | "product_update"
  | "product_adjust_stock"
  | "inventory_adjustments_list"
  | "sale_create"
  | "sale_get"
  | "sales_list";

export type AppsScriptRequestPayload = Readonly<{
  action: AppsScriptAction;
  payload?: Record<string, unknown>;
  timestamp: number;
  token?: string;
  signature?: string;
}>;

export interface AppsScriptBackendClient {
  health(): Promise<ApiResponse<HealthCheckResult>>;
  getSchemaStatus(): Promise<ApiResponse<SchemaStatusResult>>;
  initDatabase(): Promise<ApiResponse<DatabaseInitResult>>;
  createTestRecord(message: string, nonce: string): Promise<ApiResponse<SystemTestRecord>>;
  getTestRecord(identifier: string): Promise<ApiResponse<SystemTestRecord>>;
  cleanupTestRecords(identifier?: string): Promise<ApiResponse<{ deletedCount: number; message: string }>>;

  listProducts(filter?: ProductListFilter): Promise<ApiResponse<ProductListResult>>;
  createProduct(input: ProductCreateInput): Promise<ApiResponse<ProductRecord>>;
  getProduct(productId: string): Promise<ApiResponse<{ product: ProductRecord; adjustments: InventoryAdjustmentRecord[] }>>;
  updateProduct(productId: string, input: ProductUpdateInput): Promise<ApiResponse<ProductRecord>>;
  adjustStock(productId: string, input: StockAdjustmentInput): Promise<ApiResponse<{ product: ProductRecord; adjustment: InventoryAdjustmentRecord }>>;
  listInventoryAdjustments(productId?: string): Promise<ApiResponse<InventoryAdjustmentRecord[]>>;

  createSale(input: SaleCreateInput): Promise<ApiResponse<SaleWithItemsRecord>>;
  getSale(saleId: string): Promise<ApiResponse<SaleWithItemsRecord>>;
  listSales(filter?: SaleListFilter): Promise<ApiResponse<SaleRecord[]>>;
}
