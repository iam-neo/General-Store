import { createHmac } from "node:crypto";
import { getAppsScriptConfig } from "./config";
import type {
  ApiResponse,
  AppsScriptAction,
  AppsScriptBackendClient,
  AppsScriptRequestPayload,
  DatabaseInitResult,
  HealthCheckResult,
  InventoryAdjustmentRecord,
  ProductCreateInput,
  ProductListFilter,
  ProductListResult,
  ProductRecord,
  ProductUpdateInput,
  SaleCreateInput,
  SaleListFilter,
  SaleRecord,
  SaleWithItemsRecord,
  SchemaStatusResult,
  StockAdjustmentInput,
  SystemTestRecord,
} from "./types";

/**
 * Live client connecting Next.js server to deployed Google Apps Script Web App.
 * Handles redirects, timeouts, HMAC-SHA256 request signing, and response normalization.
 */
export class LiveAppsScriptClient implements AppsScriptBackendClient {
  private readonly url: string;
  private readonly secret: string | null;
  private readonly timeoutMs: number;

  constructor(timeoutMs: number = 20000) {
    const config = getAppsScriptConfig();
    if (!config.url) {
      throw new Error(
        "APPS_SCRIPT_URL is not configured. LiveAppsScriptClient cannot be initialized without a valid deployment URL."
      );
    }
    this.url = config.url;
    this.secret = config.secret;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Internal transport method dispatching actions to Google Apps Script.
   */
  private async dispatch<T>(
    action: AppsScriptAction,
    payload?: Record<string, unknown>
  ): Promise<ApiResponse<T>> {
    const timestamp = Date.now();
    let signature: string | undefined;

    if (this.secret) {
      const dataToSign = `${timestamp}.${action}.${JSON.stringify(payload ?? {})}`;
      signature = createHmac("sha256", this.secret).update(dataToSign).digest("hex");
    }

    const body: AppsScriptRequestPayload = {
      action,
      payload,
      timestamp,
      token: this.secret ?? undefined,
      signature,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (this.secret) {
      headers["Authorization"] = `Bearer ${this.secret}`;
      if (signature) {
        headers["X-Signature"] = signature;
      }
    }

    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        redirect: "follow", // Crucial for Google Apps Script 302 execution redirects
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const responseText = await response.text();

      let parsed: unknown;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        return {
          success: false,
          data: null,
          error: {
            code: "UPSTREAM_ERROR",
            message: `Google Apps Script returned a non-JSON response (HTTP ${response.status}). Ensure the web app is deployed as 'Anyone' and returns ContentService JSON.`,
            details: responseText.slice(0, 300),
          },
        };
      }

      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "success" in parsed &&
        "error" in parsed
      ) {
        return parsed as ApiResponse<T>;
      }

      return {
        success: false,
        data: null,
        error: {
          code: "UPSTREAM_ERROR",
          message: "Google Apps Script returned an unexpected response structure.",
          details: parsed,
        },
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "TimeoutError") {
        return {
          success: false,
          data: null,
          error: {
            code: "TIMEOUT_ERROR",
            message: `Request to Google Apps Script timed out after ${this.timeoutMs / 1000}s. Apps Script might be cold-starting or spreadsheet is locked.`,
          },
        };
      }

      return {
        success: false,
        data: null,
        error: {
          code: "NETWORK_ERROR",
          message:
            err instanceof Error
              ? `Failed to communicate with Google Apps Script: ${err.message}`
              : "Unknown network error communicating with Google Apps Script.",
        },
      };
    }
  }

  public async health(): Promise<ApiResponse<HealthCheckResult>> {
    return this.dispatch<HealthCheckResult>("health");
  }

  public async getSchemaStatus(): Promise<ApiResponse<SchemaStatusResult>> {
    return this.dispatch<SchemaStatusResult>("schema_status");
  }

  public async initDatabase(): Promise<ApiResponse<DatabaseInitResult>> {
    return this.dispatch<DatabaseInitResult>("init_database");
  }

  public async createTestRecord(
    message: string,
    nonce: string
  ): Promise<ApiResponse<SystemTestRecord>> {
    return this.dispatch<SystemTestRecord>("test_record_create", {
      message,
      nonce,
    });
  }

  public async getTestRecord(
    identifier: string
  ): Promise<ApiResponse<SystemTestRecord>> {
    return this.dispatch<SystemTestRecord>("test_record_get", {
      identifier,
    });
  }

  public async cleanupTestRecords(
    identifier?: string
  ): Promise<ApiResponse<{ deletedCount: number; message: string }>> {
    return this.dispatch<{ deletedCount: number; message: string }>(
      "test_record_cleanup",
      {
        identifier,
      }
    );
  }

  // ─── Product Management ──────────────────────────────────────

  public async listProducts(
    filter?: ProductListFilter
  ): Promise<ApiResponse<ProductListResult>> {
    return this.dispatch<ProductListResult>("products_list", filter as Record<string, unknown> | undefined);
  }

  public async createProduct(
    input: ProductCreateInput
  ): Promise<ApiResponse<ProductRecord>> {
    return this.dispatch<ProductRecord>("product_create", input as unknown as Record<string, unknown>);
  }

  public async getProduct(
    productId: string
  ): Promise<ApiResponse<{ product: ProductRecord; adjustments: InventoryAdjustmentRecord[] }>> {
    return this.dispatch<{ product: ProductRecord; adjustments: InventoryAdjustmentRecord[] }>(
      "product_get",
      { product_id: productId }
    );
  }

  public async updateProduct(
    productId: string,
    input: ProductUpdateInput
  ): Promise<ApiResponse<ProductRecord>> {
    return this.dispatch<ProductRecord>("product_update", {
      product_id: productId,
      ...input,
    } as Record<string, unknown>);
  }

  public async adjustStock(
    productId: string,
    input: StockAdjustmentInput
  ): Promise<ApiResponse<{ product: ProductRecord; adjustment: InventoryAdjustmentRecord }>> {
    return this.dispatch<{ product: ProductRecord; adjustment: InventoryAdjustmentRecord }>(
      "product_adjust_stock",
      { product_id: productId, ...input } as Record<string, unknown>
    );
  }

  public async listInventoryAdjustments(
    productId?: string
  ): Promise<ApiResponse<InventoryAdjustmentRecord[]>> {
    return this.dispatch<InventoryAdjustmentRecord[]>(
      "inventory_adjustments_list",
      productId ? { product_id: productId } : undefined
    );
  }

  public async createSale(input: SaleCreateInput): Promise<ApiResponse<SaleWithItemsRecord>> {
    return this.dispatch<SaleWithItemsRecord>("sale_create", input as unknown as Record<string, unknown>);
  }

  public async getSale(saleId: string): Promise<ApiResponse<SaleWithItemsRecord>> {
    return this.dispatch<SaleWithItemsRecord>("sale_get", { sale_id: saleId });
  }

  public async listSales(filter?: SaleListFilter): Promise<ApiResponse<SaleRecord[]>> {
    return this.dispatch<SaleRecord[]>("sales_list", filter as unknown as Record<string, unknown>);
  }
}
