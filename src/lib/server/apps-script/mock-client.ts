import { randomUUID } from "node:crypto";
import { DATABASE_SHEETS, inspectHeaders } from "./schema";
import type {
  ApiResponse,
  AppsScriptBackendClient,
  DatabaseInitResult,
  HealthCheckResult,
  InventoryAdjustmentRecord,
  ProductCreateInput,
  ProductListFilter,
  ProductListResult,
  ProductRecord,
  ProductSummaryStats,
  ProductUpdateInput,
  SaleCreateInput,
  SaleItemRecord,
  SaleListFilter,
  SaleRecord,
  SaleWithItemsRecord,
  SchemaStatusResult,
  SheetName,
  SheetStatusReport,
  StockAdjustmentInput,
  SystemTestRecord,
} from "./types";
import {
  isDiscreteUnit,
  isValidQuantityForUnit,
  validateProductCreate,
  validateProductUpdate,
  validateStockAdjustment,
} from "@/lib/server/products/validation";
import { getTodayDualDates } from "@/lib/date/nepali-calendar";

/**
 * In-memory mock client implementing the Google Apps Script backend contract.
 * Used during local development and testing when live Apps Script deployment is not yet configured.
 */
export class MockAppsScriptClient implements AppsScriptBackendClient {
  private sheets: Map<SheetName, { headers: string[]; rows: Record<string, unknown>[] }> = new Map();
  private testRecords: SystemTestRecord[] = [];
  private products: ProductRecord[] = [];
  private adjustments: InventoryAdjustmentRecord[] = [];
  private sales: SaleRecord[] = [];
  private saleItems: SaleItemRecord[] = [];
  private idempotencyMap: Map<string, unknown> = new Map();

  constructor(preloadDefaultSheets: boolean = false) {
    if (preloadDefaultSheets) {
      this.initDatabaseSync();
    }
  }

  private ensureSheet(name: SheetName) {
    if (!this.sheets.has(name)) {
      const def = DATABASE_SHEETS.find((s) => s.name === name);
      if (def) {
        this.sheets.set(name, {
          headers: [...def.headers],
          rows: [],
        });
      }
    }
    return this.sheets.get(name)!;
  }

  private initDatabaseSync(): string[] {
    const actions: string[] = [];
    for (const def of DATABASE_SHEETS) {
      if (!this.sheets.has(def.name)) {
        this.sheets.set(def.name, {
          headers: [...def.headers],
          rows: [],
        });
        actions.push(`Created sheet '${def.name}' with headers`);
      } else {
        const existing = this.sheets.get(def.name)!;
        if (existing.headers.length === 0) {
          existing.headers = [...def.headers];
          actions.push(`Added missing headers to empty sheet '${def.name}'`);
        }
      }
    }
    return actions;
  }

  public async health(): Promise<ApiResponse<HealthCheckResult>> {
    return {
      success: true,
      data: {
        status: "ok",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        backend: "mock-apps-script",
        environment: "development-mock",
      },
      error: null,
    };
  }

  public async getSchemaStatus(): Promise<ApiResponse<SchemaStatusResult>> {
    const reports: SheetStatusReport[] = [];
    let allCompatible = true;

    for (const def of DATABASE_SHEETS) {
      const sheetData = this.sheets.get(def.name);
      if (!sheetData) {
        allCompatible = false;
        reports.push({
          name: def.name,
          exists: false,
          status: "missing_sheet",
          expectedHeaders: def.headers,
          actualHeaders: [],
          missingHeaders: def.headers,
          extraHeaders: [],
          rowCount: 0,
        });
      } else {
        const inspected = inspectHeaders(def.name, sheetData.headers);
        if (inspected.status !== "ok") {
          allCompatible = false;
        }
        reports.push({
          ...inspected,
          exists: true,
          rowCount: sheetData.rows.length,
        });
      }
    }

    return {
      success: true,
      data: {
        isCompatible: allCompatible,
        sheets: reports,
        checkedAt: new Date().toISOString(),
      },
      error: null,
    };
  }

  public async initDatabase(): Promise<ApiResponse<DatabaseInitResult>> {
    const actions = this.initDatabaseSync();
    const statusResult = await this.getSchemaStatus();

    return {
      success: true,
      data: {
        initialized: true,
        actions,
        schemaStatus: statusResult.data!,
        timestamp: new Date().toISOString(),
      },
      error: null,
    };
  }

  public async createTestRecord(
    message: string,
    nonce: string
  ): Promise<ApiResponse<SystemTestRecord>> {
    if (!message || typeof message !== "string" || message.trim() === "") {
      return {
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Field 'message' is required and must be a non-empty string.",
        },
      };
    }

    if (!nonce || typeof nonce !== "string" || nonce.trim() === "") {
      return {
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Field 'nonce' is required and must be a non-empty string.",
        },
      };
    }

    // Check for duplicate nonce
    const existing = this.testRecords.find((r) => r.nonce === nonce.trim());
    if (existing) {
      return {
        success: false,
        data: null,
        error: {
          code: "DUPLICATE_RECORD",
          message: `A test record with nonce '${nonce}' already exists. Duplicate test submissions are rejected.`,
        },
      };
    }

    // Ensure SystemTest sheet exists
    if (!this.sheets.has("SystemTest")) {
      const def = DATABASE_SHEETS.find((s) => s.name === "SystemTest")!;
      this.sheets.set("SystemTest", {
        headers: [...def.headers],
        rows: [],
      });
    }

    const testId = `test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const record: SystemTestRecord = {
      test_id: testId,
      message: message.trim(),
      nonce: nonce.trim(),
      created_at: new Date().toISOString(),
    };

    this.testRecords.push(record);
    this.sheets.get("SystemTest")!.rows.push(record);

    return {
      success: true,
      data: record,
      error: null,
    };
  }

  public async getTestRecord(
    identifier: string
  ): Promise<ApiResponse<SystemTestRecord>> {
    if (!identifier || typeof identifier !== "string") {
      return {
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Identifier (test_id or nonce) is required.",
        },
      };
    }

    const match = this.testRecords.find(
      (r) => r.test_id === identifier || r.nonce === identifier
    );

    if (!match) {
      return {
        success: false,
        data: null,
        error: {
          code: "RECORD_NOT_FOUND",
          message: `No test record found matching identifier '${identifier}'.`,
        },
      };
    }

    return {
      success: true,
      data: match,
      error: null,
    };
  }

  public async cleanupTestRecords(
    identifier?: string
  ): Promise<ApiResponse<{ deletedCount: number; message: string }>> {
    let deletedCount = 0;

    if (identifier) {
      const initialLen = this.testRecords.length;
      this.testRecords = this.testRecords.filter(
        (r) => r.test_id !== identifier && r.nonce !== identifier
      );
      deletedCount = initialLen - this.testRecords.length;
    } else {
      deletedCount = this.testRecords.length;
      this.testRecords = [];
    }

    if (this.sheets.has("SystemTest")) {
      const st = this.sheets.get("SystemTest")!;
      if (identifier) {
        st.rows = st.rows.filter(
          (r) => r.test_id !== identifier && r.nonce !== identifier
        );
      } else {
        st.rows = [];
      }
    }

    return {
      success: true,
      data: {
        deletedCount,
        message: `Successfully cleaned up ${deletedCount} test record(s).`,
      },
      error: null,
    };
  }

  // ─── Product CRUD ──────────────────────────────────────────────

  public async listProducts(
    filter?: ProductListFilter
  ): Promise<ApiResponse<ProductListResult>> {
    this.ensureSheet("Products");

    let filtered = [...this.products];

    // Status filter
    const status = filter?.status ?? "all";
    if (status === "active") {
      filtered = filtered.filter((p) => p.is_active);
    } else if (status === "inactive") {
      filtered = filtered.filter((p) => !p.is_active);
    }

    // Category filter
    if (filter?.category) {
      const cat = filter.category.toLowerCase();
      filtered = filtered.filter((p) => p.category.toLowerCase() === cat);
    }

    // Low stock filter
    if (filter?.low_stock) {
      filtered = filtered.filter(
        (p) => p.is_active && p.stock_quantity <= p.low_stock_threshold
      );
    }

    // Search filter (name, SKU, category)
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku && p.sku.toLowerCase().includes(q)) ||
          p.category.toLowerCase().includes(q)
      );
    }

    // Sort by updated_at descending
    filtered.sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );

    // Pagination
    const page = Math.max(1, filter?.page ?? 1);
    const limit = Math.min(100, Math.max(1, filter?.limit ?? 20));
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const startIndex = (page - 1) * limit;
    const pageItems = filtered.slice(startIndex, startIndex + limit);

    // Unique categories
    const categories = [...new Set(this.products.map((p) => p.category))].sort();

    // Summary stats across all products (not just filtered)
    const summary: ProductSummaryStats = {
      totalCount: this.products.length,
      activeCount: this.products.filter((p) => p.is_active).length,
      inactiveCount: this.products.filter((p) => !p.is_active).length,
      lowStockCount: this.products.filter(
        (p) => p.is_active && p.stock_quantity > 0 && p.stock_quantity <= p.low_stock_threshold
      ).length,
      outOfStockCount: this.products.filter(
        (p) => p.is_active && p.stock_quantity <= 0
      ).length,
    };

    return {
      success: true,
      data: {
        products: pageItems,
        total,
        page,
        limit,
        totalPages,
        categories,
        summary,
      },
      error: null,
    };
  }

  public async createProduct(
    input: ProductCreateInput
  ): Promise<ApiResponse<ProductRecord>> {
    this.ensureSheet("Products");

    // Validate
    const validation = validateProductCreate(input);
    if (!validation.success) {
      return {
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: validation.errors.map((e) => e.message).join(" "),
          details: validation.errors,
        },
      };
    }

    const data = validation.data;

    // Idempotency check
    if (data.idempotency_key) {
      const cached = this.idempotencyMap.get(`product:create:${data.idempotency_key}`);
      if (cached) {
        return {
          success: true,
          data: cached as ProductRecord,
          error: null,
        };
      }
    }

    // Duplicate SKU check
    if (data.sku) {
      const existing = this.products.find(
        (p) => p.sku && p.sku.toLowerCase() === data.sku!.toLowerCase()
      );
      if (existing) {
        return {
          success: false,
          data: null,
          error: {
            code: "DUPLICATE_RECORD",
            message: `A product with SKU '${data.sku}' already exists (${existing.name}).`,
          },
        };
      }
    }

    const now = new Date().toISOString();
    const product: ProductRecord = {
      product_id: randomUUID(),
      name: data.name,
      sku: data.sku ?? null,
      category: data.category,
      unit: data.unit,
      selling_price: data.selling_price,
      cost_price: data.cost_price ?? null,
      stock_quantity: data.opening_quantity ?? 0,
      opening_quantity: data.opening_quantity ?? 0,
      low_stock_threshold: data.low_stock_threshold ?? 5,
      is_active: data.is_active ?? true,
      created_at: now,
      updated_at: now,
    };

    this.products.push(product);
    this.ensureSheet("Products").rows.push({ ...product });

    if (data.idempotency_key) {
      this.idempotencyMap.set(`product:create:${data.idempotency_key}`, product);
    }

    return {
      success: true,
      data: product,
      error: null,
    };
  }

  public async getProduct(
    productId: string
  ): Promise<ApiResponse<{ product: ProductRecord; adjustments: InventoryAdjustmentRecord[] }>> {
    if (!productId) {
      return {
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Product ID is required.",
        },
      };
    }

    const product = this.products.find((p) => p.product_id === productId);
    if (!product) {
      return {
        success: false,
        data: null,
        error: {
          code: "RECORD_NOT_FOUND",
          message: `No product found with ID '${productId}'.`,
        },
      };
    }

    const productAdjustments = this.adjustments
      .filter((a) => a.product_id === productId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return {
      success: true,
      data: { product, adjustments: productAdjustments },
      error: null,
    };
  }

  public async updateProduct(
    productId: string,
    input: ProductUpdateInput
  ): Promise<ApiResponse<ProductRecord>> {
    if (!productId) {
      return {
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Product ID is required.",
        },
      };
    }

    const validation = validateProductUpdate(input);
    if (!validation.success) {
      return {
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: validation.errors.map((e) => e.message).join(" "),
          details: validation.errors,
        },
      };
    }

    const index = this.products.findIndex((p) => p.product_id === productId);
    if (index === -1) {
      return {
        success: false,
        data: null,
        error: {
          code: "RECORD_NOT_FOUND",
          message: `No product found with ID '${productId}'.`,
        },
      };
    }

    const data = validation.data;

    // Duplicate SKU check (if updating SKU)
    if (data.sku !== undefined && data.sku !== null) {
      const existing = this.products.find(
        (p) =>
          p.product_id !== productId &&
          p.sku &&
          p.sku.toLowerCase() === data.sku!.toLowerCase()
      );
      if (existing) {
        return {
          success: false,
          data: null,
          error: {
            code: "DUPLICATE_RECORD",
            message: `A product with SKU '${data.sku}' already exists (${existing.name}).`,
          },
        };
      }
    }

    const current = this.products[index];
    const updated: ProductRecord = {
      ...current,
      ...(data.name !== undefined && { name: data.name }),
      ...(data.sku !== undefined && { sku: data.sku ?? null }),
      ...(data.category !== undefined && { category: data.category }),
      ...(data.unit !== undefined && { unit: data.unit }),
      ...(data.selling_price !== undefined && { selling_price: data.selling_price }),
      ...(data.cost_price !== undefined && { cost_price: data.cost_price ?? null }),
      ...(data.low_stock_threshold !== undefined && { low_stock_threshold: data.low_stock_threshold }),
      ...(data.is_active !== undefined && { is_active: data.is_active }),
      updated_at: new Date().toISOString(),
    };

    this.products[index] = updated;

    return {
      success: true,
      data: updated,
      error: null,
    };
  }

  public async adjustStock(
    productId: string,
    input: StockAdjustmentInput
  ): Promise<ApiResponse<{ product: ProductRecord; adjustment: InventoryAdjustmentRecord }>> {
    if (!productId) {
      return {
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Product ID is required.",
        },
      };
    }

    const validation = validateStockAdjustment(input);
    if (!validation.success) {
      return {
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: validation.errors.map((e) => e.message).join(" "),
          details: validation.errors,
        },
      };
    }

    const data = validation.data;

    // Idempotency check
    if (data.idempotency_key) {
      const cached = this.idempotencyMap.get(`stock:adjust:${data.idempotency_key}`) as
        | { product: ProductRecord; adjustment: InventoryAdjustmentRecord }
        | undefined;
      if (cached) {
        // Self-heal / reconcile product stock if previous execution was interrupted
        const prodIndex = this.products.findIndex((p) => p.product_id === productId);
        let currentProd = prodIndex !== -1 ? this.products[prodIndex] : cached.product;
        if (prodIndex !== -1 && currentProd.stock_quantity !== cached.adjustment.new_stock) {
          currentProd = {
            ...currentProd,
            stock_quantity: cached.adjustment.new_stock,
            updated_at: new Date().toISOString(),
          };
          this.products[prodIndex] = currentProd;
        }
        return {
          success: true,
          data: { product: currentProd, adjustment: cached.adjustment },
          error: null,
        };
      }
    }

    const productIndex = this.products.findIndex((p) => p.product_id === productId);
    if (productIndex === -1) {
      return {
        success: false,
        data: null,
        error: {
          code: "RECORD_NOT_FOUND",
          message: `No product found with ID '${productId}'.`,
        },
      };
    }

    const product = this.products[productIndex];

    // Unit validation: piece-based units reject fractional quantities; continuous units allow up to 3 decimals
    if (!isValidQuantityForUnit(data.quantity, product.unit)) {
      return {
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: isDiscreteUnit(product.unit)
            ? `Quantity must be a whole number for unit '${product.unit}'.`
            : `Quantity can have at most 3 decimal places for unit '${product.unit}'.`,
        },
      };
    }

    const previousStock = product.stock_quantity;
    let newStock: number;
    let quantityChange: number;

    switch (data.adjustment_type) {
      case "set":
        newStock = data.quantity;
        quantityChange = newStock - previousStock;
        break;
      case "increase":
      case "restock":
        newStock = previousStock + data.quantity;
        quantityChange = data.quantity;
        break;
      case "decrease":
      case "damage":
        quantityChange = -data.quantity;
        newStock = previousStock - data.quantity;
        break;
      case "correction":
        newStock = data.quantity;
        quantityChange = newStock - previousStock;
        break;
      default:
        newStock = previousStock;
        quantityChange = 0;
    }

    if (newStock < 0) {
      return {
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Stock quantity cannot become negative.",
        },
      };
    }

    const now = new Date().toISOString();

    const adjustment: InventoryAdjustmentRecord = {
      adjustment_id: randomUUID(),
      product_id: productId,
      adjustment_type: data.adjustment_type,
      quantity_change: quantityChange,
      previous_stock: previousStock,
      new_stock: newStock,
      reason: data.reason,
      notes: data.notes ?? null,
      actor: data.actor ?? null,
      idempotency_key: data.idempotency_key ?? null,
      created_at: now,
    };

    const updatedProduct: ProductRecord = {
      ...product,
      stock_quantity: newStock,
      updated_at: now,
    };

    this.products[productIndex] = updatedProduct;
    this.adjustments.push(adjustment);
    this.ensureSheet("InventoryAdjustments").rows.push({ ...adjustment });

    const result = { product: updatedProduct, adjustment };

    if (data.idempotency_key) {
      this.idempotencyMap.set(`stock:adjust:${data.idempotency_key}`, result);
    }

    return {
      success: true,
      data: result,
      error: null,
    };
  }

  public async listInventoryAdjustments(
    productId?: string
  ): Promise<ApiResponse<InventoryAdjustmentRecord[]>> {
    let filtered = [...this.adjustments];

    if (productId) {
      filtered = filtered.filter((a) => a.product_id === productId);
    }

    filtered.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    return {
      success: true,
      data: filtered,
      error: null,
    };
  }

  // ─── Sales & Billing ─────────────────────────────────────────

  public async createSale(
    input: SaleCreateInput
  ): Promise<ApiResponse<SaleWithItemsRecord>> {
    if (!input || !input.idempotency_key || !input.idempotency_key.trim()) {
      return {
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Field 'idempotency_key' is required for sale creation.",
        },
      };
    }

    const idempKey = input.idempotency_key.trim();

    // Idempotency check
    const cached = this.idempotencyMap.get(`sale:create:${idempKey}`) as SaleWithItemsRecord | undefined;
    if (cached) {
      return {
        success: true,
        data: cached,
        error: null,
      };
    }

    const existingSale = this.sales.find((s) => s.idempotency_key === idempKey);
    if (existingSale) {
      const items = this.saleItems.filter((i) => i.sale_id === existingSale.sale_id);
      const res: SaleWithItemsRecord = { sale: existingSale, items };
      this.idempotencyMap.set(`sale:create:${idempKey}`, res);
      return {
        success: true,
        data: res,
        error: null,
      };
    }

    if (!input.items || !Array.isArray(input.items) || input.items.length === 0) {
      return {
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Sale must contain at least one item.",
        },
      };
    }

    const discountAmount = input.discount_amount ?? 0;
    if (discountAmount < 0 || !Number.isInteger(discountAmount)) {
      return {
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Discount amount must be a non-negative integer in Paisa.",
        },
      };
    }

    type ValidatedItem = {
      product: ProductRecord;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
    };
    const validatedItems: ValidatedItem[] = [];
    let subtotal = 0;

    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i];
      if (!item.product_id) {
        return {
          success: false,
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: `Item #${i + 1} requires a product_id.`,
          },
        };
      }

      const product = this.products.find((p) => p.product_id === item.product_id);
      if (!product) {
        return {
          success: false,
          data: null,
          error: {
            code: "RECORD_NOT_FOUND",
            message: `Product '${item.product_id}' not found.`,
          },
        };
      }

      if (!product.is_active) {
        return {
          success: false,
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: `Product '${product.name}' is inactive and cannot be sold.`,
          },
        };
      }

      const qty = Number(item.quantity);
      if (isNaN(qty) || qty <= 0) {
        return {
          success: false,
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: `Item #${i + 1} quantity must be a positive number.`,
          },
        };
      }

      if (!isValidQuantityForUnit(qty, product.unit)) {
        if (isDiscreteUnit(product.unit)) {
          return {
            success: false,
            data: null,
            error: {
              code: "VALIDATION_ERROR",
              message: `Quantity must be a whole number for unit '${product.unit}' (Product: ${product.name}).`,
            },
          };
        } else {
          return {
            success: false,
            data: null,
            error: {
              code: "VALIDATION_ERROR",
              message: `Quantity can have at most 3 decimal places for unit '${product.unit}'.`,
            },
          };
        }
      }

      if (qty > product.stock_quantity) {
        return {
          success: false,
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: `Insufficient stock for '${product.name}'. Available: ${product.stock_quantity}, requested: ${qty}.`,
          },
        };
      }

      let unitPrice = product.selling_price;
      if (item.unit_price_snapshot !== undefined && item.unit_price_snapshot !== null) {
        const override = Number(item.unit_price_snapshot);
        if (isNaN(override) || !Number.isInteger(override) || override < 0) {
          return {
            success: false,
            data: null,
            error: {
              code: "VALIDATION_ERROR",
              message: `Item #${i + 1} price override must be a non-negative integer in Paisa.`,
            },
          };
        }
        unitPrice = override;
      }

      const lineTotal = Math.round(unitPrice * qty);
      subtotal += lineTotal;

      validatedItems.push({
        product,
        quantity: qty,
        unitPrice,
        lineTotal,
      });
    }

    const totalAmount = Math.max(0, subtotal - discountAmount);
    const saleId = randomUUID();
    const now = new Date();
    const nowIso = now.toISOString();
    const dualDates = getTodayDualDates();

    const dateTag = dualDates.ad.replace(/-/g, "");
    const prefix = `REC-${dateTag}-`;
    const count = this.sales.filter((s) => s.receipt_number.startsWith(prefix)).length;
    const receiptNumber = `${prefix}${String(count + 1).padStart(4, "0")}`;

    const saleRecord: SaleRecord = {
      sale_id: saleId,
      receipt_number: receiptNumber,
      customer_id: input.customer_id ?? null,
      transaction_date: dualDates.ad,
      transaction_date_bs: dualDates.bs,
      subtotal,
      discount_amount: discountAmount,
      total_amount: totalAmount,
      status: "completed",
      idempotency_key: idempKey,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const recordedItems: SaleItemRecord[] = [];

    for (const vItem of validatedItems) {
      const saleItemId = randomUUID();
      const saleItemRecord: SaleItemRecord = {
        sale_item_id: saleItemId,
        sale_id: saleId,
        product_id: vItem.product.product_id,
        product_name_snapshot: vItem.product.name,
        quantity: vItem.quantity,
        unit_price_snapshot: vItem.unitPrice,
        line_total: vItem.lineTotal,
      };

      recordedItems.push(saleItemRecord);
      this.saleItems.push(saleItemRecord);
      this.ensureSheet("SaleItems").rows.push({ ...saleItemRecord });

      const prevStock = vItem.product.stock_quantity;
      const newStock = prevStock - vItem.quantity;

      const adjId = randomUUID();
      const adjRecord: InventoryAdjustmentRecord = {
        adjustment_id: adjId,
        product_id: vItem.product.product_id,
        adjustment_type: "decrease",
        quantity_change: -vItem.quantity,
        previous_stock: prevStock,
        new_stock: newStock,
        reason: `Sale ${receiptNumber}`,
        notes: null,
        actor: input.actor ?? null,
        idempotency_key: `${idempKey}:${vItem.product.product_id}`,
        created_at: nowIso,
      };

      this.adjustments.push(adjRecord);
      this.ensureSheet("InventoryAdjustments").rows.push({ ...adjRecord });

      const prodIdx = this.products.findIndex((p) => p.product_id === vItem.product.product_id);
      if (prodIdx !== -1) {
        this.products[prodIdx] = {
          ...this.products[prodIdx],
          stock_quantity: newStock,
          updated_at: nowIso,
        };
      }
    }

    this.sales.push(saleRecord);
    this.ensureSheet("Sales").rows.push({ ...saleRecord });

    const result: SaleWithItemsRecord = {
      sale: saleRecord,
      items: recordedItems,
    };

    this.idempotencyMap.set(`sale:create:${idempKey}`, result);

    return {
      success: true,
      data: result,
      error: null,
    };
  }

  public async getSale(saleId: string): Promise<ApiResponse<SaleWithItemsRecord>> {
    if (!saleId) {
      return {
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Field 'sale_id' is required.",
        },
      };
    }

    const sale = this.sales.find((s) => s.sale_id === saleId);
    if (!sale) {
      return {
        success: false,
        data: null,
        error: {
          code: "RECORD_NOT_FOUND",
          message: `Sale with ID '${saleId}' not found.`,
        },
      };
    }

    const items = this.saleItems.filter((i) => i.sale_id === saleId);
    return {
      success: true,
      data: { sale, items },
      error: null,
    };
  }

  public async listSales(filter?: SaleListFilter): Promise<ApiResponse<SaleRecord[]>> {
    let sales = [...this.sales];

    if (filter?.start_date) {
      sales = sales.filter((s) => s.transaction_date >= filter.start_date!);
    }
    if (filter?.end_date) {
      sales = sales.filter((s) => s.transaction_date <= filter.end_date!);
    }
    if (filter?.customer_id) {
      sales = sales.filter((s) => s.customer_id === filter.customer_id);
    }
    if (filter?.status) {
      const st = filter.status.toLowerCase();
      sales = sales.filter((s) => s.status.toLowerCase() === st);
    }

    sales.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const page = Math.max(1, filter?.page ?? 1);
    const limit = Math.min(100, Math.max(1, filter?.limit ?? 20));
    const start = (page - 1) * limit;

    return {
      success: true,
      data: sales.slice(start, start + limit),
      error: null,
    };
  }

  /**
   * Diagnostic helper for testing header corruption / schema mismatch scenarios in tests.
   */
  public corruptSheetHeaders(sheetName: SheetName, badHeaders: string[]) {
    this.sheets.set(sheetName, {
      headers: badHeaders,
      rows: [],
    });
  }

  /**
   * Diagnostic helper to remove a sheet for testing missing sheet scenarios in tests.
   */
  public removeSheet(sheetName: SheetName) {
    this.sheets.delete(sheetName);
  }
}
