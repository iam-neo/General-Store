"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { ProductDetailModal } from "@/components/products/product-detail-modal";
import { ProductFormModal } from "@/components/products/product-form-modal";
import { StockAdjustmentModal } from "@/components/products/stock-adjustment-modal";
import { useLocale } from "@/lib/i18n/locale-provider";
import { formatPaisa } from "@/lib/money/format";
import type {
  ProductListResult,
  ProductRecord,
  ProductSummaryStats,
} from "@/lib/server/apps-script/types";

export function ProductsView() {
  const { t, locale } = useLocale();

  // Query state
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<"all" | "active" | "inactive" | "low_stock">("all");
  const [page, setPage] = useState(1);
  const limit = 20;

  // Data state
  const [products, setProducts] = useState<readonly ProductRecord[]>([]);
  const [categories, setCategories] = useState<readonly string[]>([]);
  const [summary, setSummary] = useState<ProductSummaryStats>({
    totalCount: 0,
    activeCount: 0,
    inactiveCount: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
  });
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [productToEdit, setProductToEdit] = useState<ProductRecord | null>(null);

  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  const [isStockOpen, setIsStockOpen] = useState(false);
  const [stockProduct, setStockProduct] = useState<ProductRecord | null>(null);

  const [copiedSkuId, setCopiedSkuId] = useState<string | null>(null);

  const [refreshCount, setRefreshCount] = useState(0);

  const refreshProducts = useCallback(() => {
    setLoading(true);
    setRefreshCount((c) => c + 1);
  }, []);

  useEffect(() => {
    let ignore = false;

    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (selectedCategory && selectedCategory !== "all") params.set("category", selectedCategory);
    if (selectedStatus === "active" || selectedStatus === "inactive") {
      params.set("status", selectedStatus);
    }
    if (selectedStatus === "low_stock") {
      params.set("low_stock", "true");
    }
    params.set("page", String(page));
    params.set("limit", String(limit));

    fetch(`/api/products?${params.toString()}`, {
      headers: { Accept: "application/json" },
    })
      .then((res) => res.json())
      .then((json: { success: boolean; data?: ProductListResult; error?: { message: string } }) => {
        if (!ignore) {
          if (json.success && json.data) {
            setProducts(json.data.products);
            setCategories(json.data.categories);
            setSummary(json.data.summary);
            setTotalPages(json.data.totalPages);
            setTotal(json.data.total);
          } else {
            setError(json.error?.message || "Failed to fetch products.");
          }
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Failed to load products.");
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [search, selectedCategory, selectedStatus, page, refreshCount]);

  // Actions
  function handleOpenCreate() {
    setProductToEdit(null);
    setIsFormOpen(true);
  }

  function handleOpenEdit(product: ProductRecord) {
    setProductToEdit(product);
    setIsFormOpen(true);
  }

  function handleOpenDetail(productId: string) {
    setSelectedProductId(productId);
    setIsDetailOpen(true);
  }

  function handleOpenStock(product: ProductRecord) {
    setStockProduct(product);
    setIsStockOpen(true);
  }

  function handleCopySku(product: ProductRecord) {
    if (!product.sku) return;
    navigator.clipboard.writeText(product.sku);
    setCopiedSkuId(product.product_id);
    setTimeout(() => setCopiedSkuId(null), 2000);
  }

  async function handleToggleStatus(product: ProductRecord) {
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(product.product_id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !product.is_active }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || "Failed to update product status.");
      }
      refreshProducts();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error updating product status.");
    }
  }

  return (
    <div className="products-view-container">
      {/* Header section */}
      <div className="products-header">
        <div>
          <h2 className="products-title">{t("productsTitle")}</h2>
          <p className="products-subtitle">{t("productsSubtitle")}</p>
        </div>
        <div className="products-header-actions">
          <button
            className="btn btn-secondary btn-icon-only"
            disabled={loading}
            onClick={() => refreshProducts()}
            title={t("refresh")}
            type="button"
          >
            <Icon className={loading ? "spin-icon" : ""} name="loader" size={16} />
          </button>
          <button className="btn btn-primary" onClick={handleOpenCreate} type="button">
            <Icon name="plus" size={16} />
            <span>{t("newProduct")}</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <section aria-label="Inventory Overview" className="products-kpi-grid">
        <div
          className={`kpi-card ${selectedStatus === "all" ? "kpi-card-active" : ""}`}
          onClick={() => {
            setSelectedStatus("all");
            setPage(1);
          }}
          role="button"
          tabIndex={0}
        >
          <div className="kpi-icon-wrap">
            <Icon name="package" size={20} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">{t("totalProducts")}</span>
            <span className="kpi-number">{summary.totalCount}</span>
          </div>
        </div>

        <div
          className={`kpi-card ${selectedStatus === "active" ? "kpi-card-active" : ""}`}
          onClick={() => {
            setSelectedStatus("active");
            setPage(1);
          }}
          role="button"
          tabIndex={0}
        >
          <div className="kpi-icon-wrap kpi-success">
            <Icon name="check" size={20} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">{t("activeProducts")}</span>
            <span className="kpi-number text-success">{summary.activeCount}</span>
          </div>
        </div>

        <div
          className={`kpi-card ${selectedStatus === "low_stock" ? "kpi-card-active" : ""}`}
          onClick={() => {
            setSelectedStatus("low_stock");
            setPage(1);
          }}
          role="button"
          tabIndex={0}
        >
          <div className="kpi-icon-wrap kpi-warning">
            <Icon name="alertTriangle" size={20} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">{t("lowStockCount")}</span>
            <span className="kpi-number text-warning">{summary.lowStockCount}</span>
          </div>
        </div>

        <div
          className={`kpi-card ${selectedStatus === "inactive" ? "kpi-card-active" : ""}`}
          onClick={() => {
            setSelectedStatus("inactive");
            setPage(1);
          }}
          role="button"
          tabIndex={0}
        >
          <div className="kpi-icon-wrap kpi-danger">
            <Icon name="x" size={20} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">{t("outOfStockCount")}</span>
            <span className="kpi-number text-danger">{summary.outOfStockCount}</span>
          </div>
        </div>
      </section>

      {/* Filter and Search Bar */}
      <div className="products-toolbar">
        {/* Search Input */}
        <div className="toolbar-search">
          <Icon className="search-icon" name="search" size={16} />
          <input
            className="search-input"
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("searchProductsPlaceholder")}
            type="search"
            value={search}
          />
          {search && (
            <button
              aria-label="Clear search"
              className="search-clear-btn"
              onClick={() => {
                setSearch("");
                setPage(1);
              }}
              type="button"
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>

        {/* Category Filter */}
        <div className="toolbar-select-wrap">
          <select
            className="toolbar-select"
            onChange={(e) => {
              setSelectedCategory(e.target.value);
              setPage(1);
            }}
            value={selectedCategory}
          >
            <option value="all">{t("allCategories")}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Status Filter Tabs */}
        <div className="toolbar-status-tabs">
          <button
            className={`tab-btn ${selectedStatus === "all" ? "tab-active" : ""}`}
            onClick={() => {
              setSelectedStatus("all");
              setPage(1);
            }}
            type="button"
          >
            {t("allStatuses")}
          </button>
          <button
            className={`tab-btn ${selectedStatus === "active" ? "tab-active" : ""}`}
            onClick={() => {
              setSelectedStatus("active");
              setPage(1);
            }}
            type="button"
          >
            {t("activeOnly")}
          </button>
          <button
            className={`tab-btn ${selectedStatus === "low_stock" ? "tab-active" : ""}`}
            onClick={() => {
              setSelectedStatus("low_stock");
              setPage(1);
            }}
            type="button"
          >
            {t("lowStockOnly")}
          </button>
          <button
            className={`tab-btn ${selectedStatus === "inactive" ? "tab-active" : ""}`}
            onClick={() => {
              setSelectedStatus("inactive");
              setPage(1);
            }}
            type="button"
          >
            {t("inactiveOnly")}
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="products-error-banner" role="alert">
          <Icon name="alertTriangle" size={18} />
          <span>{error}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => refreshProducts()} type="button">
            {t("refresh")}
          </button>
        </div>
      )}

      {/* Products Table Panel */}
      <div className="products-table-panel">
        {loading && products.length === 0 ? (
          <div className="table-loading-state">
            <span className="btn-spinner" />
            <p>{t("loading")}</p>
          </div>
        ) : products.length === 0 ? (
          <div className="table-empty-state">
            <div className="empty-icon-wrap">
              <Icon name="package" size={40} />
            </div>
            <h3>{t("noProductsFound")}</h3>
            <p>{t("productsSubtitle")}</p>
            <button className="btn btn-primary" onClick={handleOpenCreate} type="button">
              <Icon name="plus" size={16} />
              <span>{t("newProduct")}</span>
            </button>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="products-table">
              <thead>
                <tr>
                  <th>{t("productName")}</th>
                  <th>{t("barcode")}</th>
                  <th>{t("currentStock")}</th>
                  <th>{t("sellingPrice")}</th>
                  <th>{t("costPrice")}</th>
                  <th>{t("productStatus")}</th>
                  <th className="text-right">{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const isLow = p.is_active && p.stock_quantity > 0 && p.stock_quantity <= p.low_stock_threshold;
                  const isOut = p.is_active && p.stock_quantity <= 0;
                  const profitPaisa =
                    p.cost_price !== null && p.cost_price !== undefined
                      ? p.selling_price - p.cost_price
                      : null;
                  const margin =
                    profitPaisa !== null && p.selling_price > 0
                      ? Math.round((profitPaisa / p.selling_price) * 1000) / 10
                      : null;

                  return (
                    <tr className="product-row" key={p.product_id}>
                      {/* Name & Category */}
                      <td>
                        <button
                          className="product-name-btn"
                          onClick={() => handleOpenDetail(p.product_id)}
                          type="button"
                        >
                          <span className="prod-name-text">{p.name}</span>
                          <span className="prod-meta-tags">
                            <span className="tag-category">{p.category}</span>
                            <span className="tag-unit">{p.unit}</span>
                          </span>
                        </button>
                      </td>

                      {/* Barcode / SKU */}
                      <td>
                        {p.sku ? (
                          <div className="sku-cell">
                            <code className="sku-text">{p.sku}</code>
                            <button
                              aria-label={t("copyBarcode")}
                              className="sku-mini-copy"
                              onClick={() => handleCopySku(p)}
                              title={t("copyBarcode")}
                              type="button"
                            >
                              <Icon
                                name={copiedSkuId === p.product_id ? "check" : "barcode"}
                                size={14}
                              />
                            </button>
                          </div>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>

                      {/* Stock Quantity */}
                      <td>
                        <div className="stock-cell">
                          <span
                            className={`stock-badge-pill ${
                              isOut
                                ? "pill-out"
                                : isLow
                                ? "pill-low"
                                : "pill-in"
                            }`}
                          >
                            {p.stock_quantity} {p.unit}
                          </span>
                          {isOut && <span className="stock-alert-text text-danger">{t("outOfStockWarning")}</span>}
                          {isLow && (
                            <span className="stock-alert-text text-warning">
                              {t("lowStockWarning")} (≤{p.low_stock_threshold})
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Selling Price */}
                      <td>
                        <span className="price-bold">
                          {formatPaisa(p.selling_price, locale)}
                        </span>
                      </td>

                      {/* Cost Price & Margin */}
                      <td>
                        {p.cost_price !== null ? (
                          <div className="cost-margin-cell">
                            <span className="text-muted">
                              {formatPaisa(p.cost_price, locale)}
                            </span>
                            {margin !== null && (
                              <span
                                className={`margin-pill ${
                                  margin < 0 ? "margin-negative" : "margin-positive"
                                }`}
                              >
                                {margin}%
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td>
                        <span
                          className={`status-pill ${
                            p.is_active ? "status-active" : "status-inactive"
                          }`}
                        >
                          {p.is_active ? t("active") : t("inactive")}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="text-right">
                        <div className="row-action-btns">
                          <button
                            className="action-icon-btn"
                            onClick={() => handleOpenStock(p)}
                            title={t("adjustStock")}
                            type="button"
                          >
                            <Icon name="stockUp" size={15} />
                          </button>
                          <button
                            className="action-icon-btn"
                            onClick={() => handleOpenEdit(p)}
                            title={t("editProduct")}
                            type="button"
                          >
                            <Icon name="edit" size={15} />
                          </button>
                          <button
                            className="action-icon-btn"
                            onClick={() => handleOpenDetail(p.product_id)}
                            title={t("productDetails")}
                            type="button"
                          >
                            <Icon name="eye" size={15} />
                          </button>
                          <button
                            className={`action-icon-btn ${
                              p.is_active ? "btn-icon-deactivate" : "btn-icon-activate"
                            }`}
                            onClick={() => handleToggleStatus(p)}
                            title={p.is_active ? t("deactivateProduct") : t("activateProduct")}
                            type="button"
                          >
                            <Icon name={p.is_active ? "x" : "check"} size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="table-pagination">
            <span className="pagination-info">
              {t("page")} <strong>{page}</strong> {t("of")} <strong>{totalPages}</strong> (
              {total} items)
            </span>
            <div className="pagination-controls">
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                type="button"
              >
                <Icon name="chevronLeft" size={14} />
                <span>{t("previous")}</span>
              </button>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                type="button"
              >
                <span>{t("next")}</span>
                <Icon name="chevronRight" size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add / Edit Product Modal */}
      <ProductFormModal
        existingCategories={categories}
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setProductToEdit(null);
        }}
        onSuccess={() => {
          refreshProducts();
        }}
        productToEdit={productToEdit}
      />

      {/* Product Detail Modal with Audit History */}
      <ProductDetailModal
        isOpen={isDetailOpen}
        onAdjustStock={(prod) => {
          handleOpenStock(prod);
        }}
        onClose={() => {
          setIsDetailOpen(false);
          setSelectedProductId(null);
        }}
        onEdit={(prod) => {
          handleOpenEdit(prod);
        }}
        onProductUpdated={() => {
          refreshProducts();
        }}
        productId={selectedProductId}
      />

      {/* Stock Adjustment Modal */}
      <StockAdjustmentModal
        isOpen={isStockOpen}
        onClose={() => {
          setIsStockOpen(false);
          setStockProduct(null);
        }}
        onSuccess={() => {
          refreshProducts();
        }}
        product={stockProduct}
      />
    </div>
  );
}
