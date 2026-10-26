"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/lib/i18n/locale-provider";
import { formatPaisa } from "@/lib/money/format";
import type { InventoryAdjustmentRecord, ProductRecord } from "@/lib/server/apps-script/types";

export type ProductDetailModalProps = Readonly<{
  isOpen: boolean;
  productId: string | null;
  onClose: () => void;
  onEdit: (product: ProductRecord) => void;
  onAdjustStock: (product: ProductRecord) => void;
  onProductUpdated: (product: ProductRecord) => void;
}>;

export function ProductDetailModal({
  isOpen,
  productId,
  onClose,
  onEdit,
  onAdjustStock,
  onProductUpdated,
}: ProductDetailModalProps) {
  const { t, locale } = useLocale();

  const [product, setProduct] = useState<ProductRecord | null>(null);
  const [adjustments, setAdjustments] = useState<readonly InventoryAdjustmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedSku, setCopiedSku] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);

  useEffect(() => {
    if (!isOpen || !productId) return;

    let ignore = false;

    fetch(`/api/products/${encodeURIComponent(productId)}`, {
      headers: { Accept: "application/json" },
    })
      .then((res) => res.json())
      .then((json) => {
        if (!ignore) {
          if (json.success && json.data) {
            setProduct(json.data.product);
            setAdjustments(json.data.adjustments || []);
          } else {
            setError(json.error?.message || "Failed to load product details.");
          }
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Failed to load product.");
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [isOpen, productId]);

  if (!isOpen) return null;

  async function handleToggleStatus() {
    if (!product) return;
    setTogglingStatus(true);
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
      setProduct(json.data);
      onProductUpdated(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to toggle status.");
    } finally {
      setTogglingStatus(false);
    }
  }

  function handleCopySku() {
    if (!product?.sku) return;
    navigator.clipboard.writeText(product.sku);
    setCopiedSku(true);
    setTimeout(() => setCopiedSku(false), 2000);
  }

  // Margin calculation
  const selling = product?.selling_price ?? 0;
  const cost = product?.cost_price ?? null;
  const profitPaisa = cost !== null ? selling - cost : null;
  const profitMargin =
    profitPaisa !== null && selling > 0
      ? Math.round((profitPaisa / selling) * 1000) / 10
      : null;

  const isLowStock =
    Boolean(product && product.is_active && product.stock_quantity <= product.low_stock_threshold && product.stock_quantity > 0);
  const isOutOfStock = Boolean(product && product.is_active && product.stock_quantity <= 0);

  return (
    <div
      aria-labelledby="product-detail-title"
      aria-modal="true"
      className="modal-backdrop"
      role="dialog"
    >
      <div className="modal-container modal-wide">
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="modal-icon-badge detail-badge">
              <Icon name="package" size={20} />
            </span>
            <div>
              <div className="detail-header-row">
                <h3 className="modal-title" id="product-detail-title">
                  {product?.name || t("productDetails")}
                </h3>
                {product && (
                  <span
                    className={`status-chip ${product.is_active ? "chip-active" : "chip-inactive"}`}
                  >
                    {product.is_active ? t("active") : t("inactive")}
                  </span>
                )}
              </div>
              <p className="modal-subtitle">
                {product?.category} · {product?.unit}
              </p>
            </div>
          </div>
          <button
            aria-label={t("closeModal")}
            className="modal-close-btn"
            onClick={onClose}
            type="button"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        {error && (
          <div className="modal-error-banner" role="alert">
            <Icon name="alertTriangle" size={16} />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="modal-loading-state">
            <span className="btn-spinner" />
            <span>{t("loading")}</span>
          </div>
        ) : product ? (
          <div className="product-detail-content">
            {/* Quick Action Bar */}
            <div className="detail-action-bar">
              <button
                className="btn btn-primary"
                onClick={() => {
                  onAdjustStock(product);
                  onClose();
                }}
                type="button"
              >
                <Icon name="stockUp" size={16} />
                <span>{t("adjustStock")}</span>
              </button>

              <button
                className="btn btn-secondary"
                onClick={() => {
                  onEdit(product);
                  onClose();
                }}
                type="button"
              >
                <Icon name="edit" size={16} />
                <span>{t("editProduct")}</span>
              </button>

              <button
                className={`btn ${product.is_active ? "btn-danger-outline" : "btn-success-outline"}`}
                disabled={togglingStatus}
                onClick={handleToggleStatus}
                type="button"
              >
                <Icon name={product.is_active ? "x" : "check"} size={16} />
                <span>
                  {product.is_active ? t("deactivateProduct") : t("activateProduct")}
                </span>
              </button>
            </div>

            {/* Metrics Grid */}
            <div className="detail-metrics-grid">
              {/* Stock Metric */}
              <div className="detail-metric-card">
                <span className="metric-label">{t("currentStock")}</span>
                <div className="metric-value-row">
                  <span
                    className={`metric-number ${
                      isOutOfStock ? "text-danger" : isLowStock ? "text-warning" : "text-success"
                    }`}
                  >
                    {product.stock_quantity}
                  </span>
                  <span className="metric-unit">{product.unit}</span>
                </div>
                <div className="metric-hint">
                  {isOutOfStock ? (
                    <span className="stock-alert-tag tag-danger">
                      <Icon name="alertTriangle" size={12} /> {t("outOfStockWarning")}
                    </span>
                  ) : isLowStock ? (
                    <span className="stock-alert-tag tag-warning">
                      <Icon name="alertTriangle" size={12} /> {t("lowStockWarning")} (≤ {product.low_stock_threshold})
                    </span>
                  ) : (
                    <span className="stock-alert-tag tag-success">
                      <Icon name="check" size={12} /> {t("inStock")} (min: {product.low_stock_threshold})
                    </span>
                  )}
                </div>
              </div>

              {/* Selling Price */}
              <div className="detail-metric-card">
                <span className="metric-label">{t("sellingPrice")}</span>
                <span className="metric-number metric-currency">
                  {formatPaisa(product.selling_price, locale)}
                </span>
                <span className="metric-hint">{t("perUnit")}</span>
              </div>

              {/* Cost Price */}
              <div className="detail-metric-card">
                <span className="metric-label">{t("costPrice")}</span>
                <span className="metric-number metric-currency">
                  {product.cost_price ? formatPaisa(product.cost_price, locale) : "—"}
                </span>
                <span className="metric-hint">{t("perUnit")}</span>
              </div>

              {/* Profit & Margin */}
              <div className="detail-metric-card">
                <span className="metric-label">{t("profitMargin")}</span>
                <div className="metric-value-row">
                  <span
                    className={`metric-number ${
                      profitPaisa !== null && profitPaisa < 0 ? "text-danger" : "text-success"
                    }`}
                  >
                    {profitMargin !== null ? `${profitMargin}%` : "—"}
                  </span>
                </div>
                <span className="metric-hint">
                  {profitPaisa !== null
                    ? `${formatPaisa(profitPaisa, locale)} ${t("perUnit")}`
                    : "No cost price"}
                </span>
              </div>
            </div>

            {/* SKU / Barcode Bar */}
            {product.sku && (
              <div className="detail-sku-strip">
                <div className="sku-info">
                  <Icon name="barcode" size={18} />
                  <span className="sku-label">{t("barcode")}:</span>
                  <code className="sku-code">{product.sku}</code>
                </div>
                <button
                  className="sku-copy-button"
                  onClick={handleCopySku}
                  title={t("copyBarcode")}
                  type="button"
                >
                  <Icon name={copiedSku ? "check" : "receipt"} size={14} />
                  <span>{copiedSku ? t("copied") : t("copyBarcode")}</span>
                </button>
              </div>
            )}

            {/* Stock Adjustment Audit Trail */}
            <div className="detail-audit-section">
              <div className="audit-section-header">
                <h4 className="audit-title">
                  <Icon name="reports" size={16} />
                  <span>{t("stockAdjustmentHistory")}</span>
                </h4>
                <span className="audit-count">
                  {adjustments.length} {adjustments.length === 1 ? "record" : "records"}
                </span>
              </div>

              {adjustments.length === 0 ? (
                <div className="audit-empty-state">
                  <Icon name="package" size={24} />
                  <p>{t("noAdjustmentsFound")}</p>
                </div>
              ) : (
                <div className="audit-table-wrap">
                  <table className="audit-table">
                    <thead>
                      <tr>
                        <th>{t("date")}</th>
                        <th>{t("adjustmentType")}</th>
                        <th>{t("currentStock")} → {t("adjustmentQty")}</th>
                        <th>Change</th>
                        <th>{t("adjustmentReason")}</th>
                        <th>{t("adjustmentNotes")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adjustments.map((adj) => {
                        const isPositive = adj.quantity_change > 0;
                        const isNegative = adj.quantity_change < 0;
                        return (
                          <tr key={adj.adjustment_id}>
                            <td className="cell-date">
                              {adj.created_at ? new Date(adj.created_at).toLocaleString() : "—"}
                            </td>
                            <td>
                              <span className={`adj-type-pill pill-${adj.adjustment_type}`}>
                                {adj.adjustment_type}
                              </span>
                            </td>
                            <td className="cell-qty-flow">
                              <span>{adj.previous_stock}</span>
                              <span className="flow-arrow">→</span>
                              <strong>{adj.new_stock}</strong>
                            </td>
                            <td>
                              <span
                                className={`qty-delta ${
                                  isPositive
                                    ? "delta-positive"
                                    : isNegative
                                    ? "delta-negative"
                                    : "delta-neutral"
                                }`}
                              >
                                {isPositive ? `+${adj.quantity_change}` : adj.quantity_change}
                              </span>
                            </td>
                            <td className="cell-reason">{adj.reason}</td>
                            <td className="cell-notes">{adj.notes || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} type="button">
            {t("closeModal")}
          </button>
        </div>
      </div>
    </div>
  );
}
