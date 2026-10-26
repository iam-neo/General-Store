"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/lib/i18n/locale-provider";
import type { ProductRecord } from "@/lib/server/apps-script/types";

export type StockAdjustmentModalProps = Readonly<{
  isOpen: boolean;
  product: ProductRecord | null;
  onClose: () => void;
  onSuccess: (updatedProduct: ProductRecord) => void;
}>;

type AdjustmentType = "restock" | "damage" | "correction" | "increase" | "decrease" | "set";

export function StockAdjustmentModal({
  isOpen,
  product,
  onClose,
  onSuccess,
}: StockAdjustmentModalProps) {
  const { t } = useLocale();

  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>("restock");
  const [quantityInput, setQuantityInput] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !product) return null;

  const currentStock = product.stock_quantity;
  const parsedQty = parseFloat(quantityInput) || 0;

  // Calculate preview of new stock
  let projectedStock = currentStock;
  let changeAmount = 0;

  if (adjustmentType === "set" || adjustmentType === "correction") {
    projectedStock = parsedQty;
    changeAmount = projectedStock - currentStock;
  } else if (adjustmentType === "increase" || adjustmentType === "restock") {
    changeAmount = parsedQty;
    projectedStock = currentStock + parsedQty;
  } else if (adjustmentType === "decrease" || adjustmentType === "damage") {
    changeAmount = -parsedQty;
    projectedStock = currentStock - parsedQty;
  }

  const isDiscrete =
    product.unit === "piece" || product.unit === "packet" || product.unit === "bottle";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;
    setError(null);

    if (!quantityInput || parsedQty < 0) {
      setError(t("adjustmentQty") + " must be a positive number.");
      return;
    }

    if (isDiscrete && !Number.isInteger(parsedQty)) {
      setError(`Quantities for ${product?.unit} must be a whole number.`);
      return;
    }

    if (projectedStock < 0) {
      setError("Stock cannot be adjusted to a negative quantity.");
      return;
    }

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError(t("adjustmentReason") + " is required.");
      return;
    }

    setLoading(true);

    try {
      const payload = {
        adjustment_type: adjustmentType,
        quantity: parsedQty,
        reason: trimmedReason,
        notes: notes.trim() || null,
        idempotency_key: idempotencyKey,
      };

      const res = await fetch(
        `/api/products/${encodeURIComponent(product.product_id)}/stock`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || "Failed to adjust stock.");
      }

      onSuccess(json.data.product);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      aria-labelledby="stock-modal-title"
      aria-modal="true"
      className="modal-backdrop"
      role="dialog"
    >
      <div className="modal-container">
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="modal-icon-badge stock-badge">
              <Icon name="stockUp" size={20} />
            </span>
            <div>
              <h3 className="modal-title" id="stock-modal-title">
                {t("adjustStock")}
              </h3>
              <p className="modal-subtitle">
                {product.name} ({product.category})
              </p>
            </div>
          </div>
          <button
            aria-label={t("closeModal")}
            className="modal-close-btn"
            disabled={loading}
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

        <form className="modal-form" onSubmit={handleSubmit}>
          {/* Stock Info Callout */}
          <div className="stock-preview-box">
            <div className="stock-preview-col">
              <span className="stock-preview-label">{t("currentStock")}</span>
              <span className="stock-preview-num">
                {currentStock} <span className="unit-text">{product.unit}</span>
              </span>
            </div>

            <div className="stock-preview-arrow">
              <Icon name="arrow" size={20} />
            </div>

            <div className="stock-preview-col">
              <span className="stock-preview-label">{t("adjustmentQty")}</span>
              <span
                className={`stock-preview-num ${
                  projectedStock < product.low_stock_threshold ? "text-warning" : "text-success"
                }`}
              >
                {projectedStock} <span className="unit-text">{product.unit}</span>
              </span>
            </div>

            {changeAmount !== 0 && (
              <div className="stock-delta-pill">
                {changeAmount > 0 ? `+${changeAmount}` : `${changeAmount}`} {product.unit}
              </div>
            )}
          </div>

          {/* Adjustment Type Selector */}
          <div className="form-group">
            <label className="form-label" htmlFor="adj-type">
              {t("adjustmentType")}
            </label>
            <div className="adjustment-type-grid">
              <button
                className={`adj-type-btn ${adjustmentType === "restock" ? "selected" : ""}`}
                onClick={() => setAdjustmentType("restock")}
                type="button"
              >
                <Icon name="stockUp" size={16} />
                <span>{t("adjustmentRestock")}</span>
              </button>

              <button
                className={`adj-type-btn ${adjustmentType === "damage" ? "selected" : ""}`}
                onClick={() => setAdjustmentType("damage")}
                type="button"
              >
                <Icon name="stockDown" size={16} />
                <span>{t("adjustmentDamage")}</span>
              </button>

              <button
                className={`adj-type-btn ${adjustmentType === "correction" ? "selected" : ""}`}
                onClick={() => setAdjustmentType("correction")}
                type="button"
              >
                <Icon name="edit" size={16} />
                <span>{t("adjustmentCorrection")}</span>
              </button>
            </div>
          </div>

          {/* Quantity Input */}
          <div className="form-group">
            <label className="form-label" htmlFor="adj-quantity">
              {adjustmentType === "correction" || adjustmentType === "set"
                ? `${t("adjustmentSet")} (${product.unit})`
                : `${t("adjustmentQty")} (${product.unit})`}{" "}
              <span className="text-danger">*</span>
            </label>
            <input
              autoFocus
              className="form-input"
              id="adj-quantity"
              min="0"
              onChange={(e) => setQuantityInput(e.target.value)}
              placeholder="0"
              required
              step={isDiscrete ? "1" : "0.01"}
              type="number"
              value={quantityInput}
            />
          </div>

          {/* Reason Input */}
          <div className="form-group">
            <label className="form-label" htmlFor="adj-reason">
              {t("adjustmentReason")} <span className="text-danger">*</span>
            </label>
            <input
              className="form-input"
              id="adj-reason"
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("adjustmentReasonPlaceholder")}
              required
              type="text"
              value={reason}
            />
          </div>

          {/* Notes Input */}
          <div className="form-group">
            <label className="form-label" htmlFor="adj-notes">
              {t("adjustmentNotes")}
            </label>
            <textarea
              className="form-textarea"
              id="adj-notes"
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("adjustmentNotesPlaceholder")}
              rows={2}
              value={notes}
            />
          </div>

          <div className="modal-actions">
            <button
              className="btn btn-secondary"
              disabled={loading}
              onClick={onClose}
              type="button"
            >
              {t("cancel")}
            </button>
            <button className="btn btn-primary" disabled={loading} type="submit">
              {loading ? (
                <>
                  <span className="btn-spinner" />
                  {t("saving")}
                </>
              ) : (
                <>
                  <Icon name="check" size={16} />
                  {t("confirm")}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
