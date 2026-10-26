"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/lib/i18n/locale-provider";
import { formatPaisa, paisaToRupees, rupeesToPaisa } from "@/lib/money/format";
import type { ProductRecord, ProductUnit } from "@/lib/server/apps-script/types";

export type ProductFormModalProps = Readonly<{
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (product: ProductRecord) => void;
  productToEdit?: ProductRecord | null;
  existingCategories?: readonly string[];
}>;

const COMMON_CATEGORIES = [
  "Groceries",
  "Snacks & Biscuits",
  "Beverages & Tea",
  "Spices & Masala",
  "Rice & Grains",
  "Lentils & Pulses",
  "Oils & Ghee",
  "Dairy & Bakery",
  "Personal Care",
  "Household & Cleaning",
  "Stationery",
  "General",
] as const;

const AVAILABLE_UNITS: readonly ProductUnit[] = [
  "piece",
  "packet",
  "kg",
  "gram",
  "litre",
  "bottle",
  "metre",
];

export function ProductFormModal({
  isOpen,
  onClose,
  onSuccess,
  productToEdit,
  existingCategories = [],
}: ProductFormModalProps) {
  const { t, locale } = useLocale();
  const isEditing = Boolean(productToEdit);

  // Form states
  const [name, setName] = useState(productToEdit?.name ?? "");
  const [sku, setSku] = useState(productToEdit?.sku ?? "");
  const [category, setCategory] = useState(productToEdit?.category ?? "Groceries");
  const [unit, setUnit] = useState<ProductUnit>(
    (productToEdit?.unit as ProductUnit) ?? "piece"
  );
  const [sellingPriceRupees, setSellingPriceRupees] = useState(
    productToEdit ? String(paisaToRupees(productToEdit.selling_price)) : ""
  );
  const [costPriceRupees, setCostPriceRupees] = useState(
    productToEdit?.cost_price !== null && productToEdit?.cost_price !== undefined
      ? String(paisaToRupees(productToEdit.cost_price))
      : ""
  );
  const [openingQuantity, setOpeningQuantity] = useState(
    productToEdit ? String(productToEdit.opening_quantity) : "0"
  );
  const [lowStockThreshold, setLowStockThreshold] = useState(
    productToEdit ? String(productToEdit.low_stock_threshold) : "5"
  );
  const [isActive, setIsActive] = useState(productToEdit?.is_active ?? true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  // Real-time financial calculations
  const parsedSellingRupees = parseFloat(sellingPriceRupees) || 0;
  const parsedCostRupees = parseFloat(costPriceRupees) || 0;
  const sellingPaisa = rupeesToPaisa(parsedSellingRupees);
  const costPaisa = costPriceRupees ? rupeesToPaisa(parsedCostRupees) : null;
  const isSellingLessThanCost =
    costPaisa !== null && costPaisa > 0 && sellingPaisa > 0 && sellingPaisa < costPaisa;

  const profitPaisa = costPaisa !== null ? sellingPaisa - costPaisa : null;
  const profitMarginPercent =
    profitPaisa !== null && sellingPaisa > 0
      ? Math.round((profitPaisa / sellingPaisa) * 1000) / 10
      : null;

  // Categories list
  const allCategoryOptions = Array.from(
    new Set([...COMMON_CATEGORIES, ...existingCategories])
  ).sort();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t("productName") + " is required.");
      return;
    }

    if (sellingPaisa <= 0) {
      setError(t("sellingPrice") + " must be greater than zero.");
      return;
    }

    setLoading(true);

    try {
      if (isEditing && productToEdit) {
        // Update product
        const payload = {
          name: trimmedName,
          sku: sku.trim() || null,
          category: category.trim() || "General",
          unit,
          selling_price: sellingPaisa,
          cost_price: costPaisa,
          low_stock_threshold: parseInt(lowStockThreshold, 10) || 5,
          is_active: isActive,
        };

        const res = await fetch(`/api/products/${encodeURIComponent(productToEdit.product_id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error?.message || "Failed to update product.");
        }

        onSuccess(json.data);
        onClose();
      } else {
        // Create product
        const payload = {
          name: trimmedName,
          sku: sku.trim() || null,
          category: category.trim() || "General",
          unit,
          selling_price: sellingPaisa,
          cost_price: costPaisa,
          opening_quantity: parseFloat(openingQuantity) || 0,
          low_stock_threshold: parseInt(lowStockThreshold, 10) || 5,
          is_active: isActive,
          idempotency_key: crypto.randomUUID(),
        };

        const res = await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error?.message || "Failed to create product.");
        }

        onSuccess(json.data);
        onClose();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      aria-labelledby="product-modal-title"
      aria-modal="true"
      className="modal-backdrop"
      role="dialog"
    >
      <div className="modal-container">
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="modal-icon-badge">
              <Icon name={isEditing ? "edit" : "plus"} size={20} />
            </span>
            <div>
              <h3 className="modal-title" id="product-modal-title">
                {isEditing ? t("editProduct") : t("newProduct")}
              </h3>
              <p className="modal-subtitle">
                {isEditing
                  ? productToEdit?.name
                  : t("productsSubtitle")}
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
          {/* Row 1: Name & Barcode */}
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label" htmlFor="prod-name">
                {t("productName")} <span className="text-danger">*</span>
              </label>
              <input
                className="form-input"
                id="prod-name"
                onChange={(e) => setName(e.target.value)}
                placeholder={t("productNamePlaceholder")}
                required
                type="text"
                value={name}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="prod-sku">
                {t("barcode")}
              </label>
              <div className="input-with-icon">
                <input
                  className="form-input"
                  id="prod-sku"
                  onChange={(e) => setSku(e.target.value)}
                  placeholder={t("barcodePlaceholder")}
                  type="text"
                  value={sku}
                />
                <span className="input-affix-icon">
                  <Icon name="barcode" size={16} />
                </span>
              </div>
            </div>
          </div>

          {/* Row 2: Category & Unit */}
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label" htmlFor="prod-category">
                {t("productCategory")}
              </label>
              <input
                className="form-input"
                id="prod-category"
                list="category-suggestions"
                onChange={(e) => setCategory(e.target.value)}
                placeholder={t("productCategoryPlaceholder")}
                type="text"
                value={category}
              />
              <datalist id="category-suggestions">
                {allCategoryOptions.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="prod-unit">
                {t("productUnit")}
              </label>
              <select
                className="form-select"
                id="prod-unit"
                onChange={(e) => setUnit(e.target.value as ProductUnit)}
                value={unit}
              >
                {AVAILABLE_UNITS.map((u) => {
                  let labelKey: "unitPiece" | "unitKg" | "unitGram" | "unitLitre" | "unitPacket" | "unitBottle" | "unitMetre" = "unitPiece";
                  if (u === "piece") labelKey = "unitPiece";
                  else if (u === "kg") labelKey = "unitKg";
                  else if (u === "gram") labelKey = "unitGram";
                  else if (u === "litre") labelKey = "unitLitre";
                  else if (u === "packet") labelKey = "unitPacket";
                  else if (u === "bottle") labelKey = "unitBottle";
                  else if (u === "metre") labelKey = "unitMetre";
                  return (
                    <option key={u} value={u}>
                      {t(labelKey)}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Row 3: Pricing (Selling Price & Cost Price) */}
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label" htmlFor="prod-selling-price">
                {t("sellingPrice")} (रु) <span className="text-danger">*</span>
              </label>
              <input
                className="form-input"
                id="prod-selling-price"
                min="0.01"
                onChange={(e) => setSellingPriceRupees(e.target.value)}
                placeholder="0.00"
                required
                step="0.01"
                type="number"
                value={sellingPriceRupees}
              />
              <span className="form-hint">{t("sellingPriceHint")}</span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="prod-cost-price">
                {t("costPrice")} (रु)
              </label>
              <input
                className="form-input"
                id="prod-cost-price"
                min="0"
                onChange={(e) => setCostPriceRupees(e.target.value)}
                placeholder="0.00"
                step="0.01"
                type="number"
                value={costPriceRupees}
              />
              <span className="form-hint">{t("costPriceHint")}</span>
            </div>
          </div>

          {/* Real-time Profit Calculation Card */}
          {sellingPaisa > 0 && costPaisa !== null && (
            <div className={`profit-calculator-card ${isSellingLessThanCost ? "warning" : "positive"}`}>
              <div className="profit-calculator-details">
                <span className="profit-title">{t("estimatedProfit")}</span>
                <span className="profit-value">
                  {formatPaisa(profitPaisa, locale)} <span className="profit-subtext">({profitMarginPercent}%)</span>
                </span>
              </div>
              {isSellingLessThanCost && (
                <div className="profit-alert-warning">
                  <Icon name="alertTriangle" size={14} />
                  <span>{t("priceWarning")}</span>
                </div>
              )}
            </div>
          )}

          {/* Row 4: Quantities (Opening Stock only for new product, Low Stock Threshold) */}
          <div className="form-grid-2">
            {!isEditing && (
              <div className="form-group">
                <label className="form-label" htmlFor="prod-opening-qty">
                  {t("openingQuantity")}
                </label>
                <input
                  className="form-input"
                  id="prod-opening-qty"
                  min="0"
                  onChange={(e) => setOpeningQuantity(e.target.value)}
                  placeholder="0"
                  step={unit === "piece" || unit === "packet" || unit === "bottle" ? "1" : "0.01"}
                  type="number"
                  value={openingQuantity}
                />
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="prod-threshold">
                {t("lowStockThreshold")}
              </label>
              <input
                className="form-input"
                id="prod-threshold"
                min="0"
                onChange={(e) => setLowStockThreshold(e.target.value)}
                placeholder="5"
                step="1"
                type="number"
                value={lowStockThreshold}
              />
              <span className="form-hint">{t("lowStockThresholdHint")}</span>
            </div>
          </div>

          {/* Status Checkbox */}
          <div className="form-checkbox-group">
            <label className="checkbox-label" htmlFor="prod-active">
              <input
                checked={isActive}
                id="prod-active"
                onChange={(e) => setIsActive(e.target.checked)}
                type="checkbox"
              />
              <span className="checkbox-text">
                <strong>{t("active")}</strong> — {t("productStatus")}
              </span>
            </label>
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
                  {t("save")}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
