"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { ReceiptModal } from "@/components/sales/receipt-modal";
import { useLocale } from "@/lib/i18n/locale-provider";
import { formatPaisa, paisaToRupees, rupeesToPaisa } from "@/lib/money/format";
import { formatBikramSambatDate, getTodayDualDates } from "@/lib/date/nepali-calendar";
import type {
  ProductRecord,
  ProductListResult,
  SaleWithItemsRecord,
} from "@/lib/server/apps-script/types";

type CartItem = {
  productId: string;
  name: string;
  unit: string;
  unitPrice: number; // in integer Paisa
  stockQuantity: number;
  quantity: number;
  lineTotal: number; // in integer Paisa
};

export function PosRegister() {
  const { t, locale } = useLocale();

  // Search & Catalog Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [products, setProducts] = useState<readonly ProductRecord[]>([]);
  const [categories, setCategories] = useState<readonly string[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productError, setProductError] = useState<string | null>(null);

  // Cart State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountRupees, setDiscountRupees] = useState<string>("");
  const [cashTenderedRupees, setCashTenderedRupees] = useState<string>("");

  // Checkout State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [completedSale, setCompletedSale] = useState<SaleWithItemsRecord | null>(null);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);

  // Current dual dates
  const todayDates = useMemo(() => getTodayDualDates(), []);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const [refreshCount, setRefreshCount] = useState(0);

  const refreshProducts = useCallback(() => {
    setLoadingProducts(true);
    setRefreshCount((c) => c + 1);
  }, []);

  useEffect(() => {
    let ignore = false;

    fetch("/api/products?status=active&limit=100", {
      headers: { Accept: "application/json" },
    })
      .then((res) => res.json())
      .then((data: { success: boolean; data?: ProductListResult; error?: { message: string } }) => {
        if (!ignore) {
          if (data.success && data.data) {
            setProducts(data.data.products);
            setCategories(data.data.categories || []);
            setProductError(null);
          } else {
            setProductError(data.error?.message || "Failed to load products");
          }
          setLoadingProducts(false);
        }
      })
      .catch(() => {
        if (!ignore) {
          setProductError("Network error while loading catalog.");
          setLoadingProducts(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [refreshCount]);

  // Filtered products list for POS catalog
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      // Category filter
      if (selectedCategory !== "all" && p.category.toLowerCase() !== selectedCategory.toLowerCase()) {
        return false;
      }
      // Query filter (name or SKU)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = p.name.toLowerCase().includes(q);
        const matchesSku = p.sku ? p.sku.toLowerCase().includes(q) : false;
        return matchesName || matchesSku;
      }
      return true;
    });
  }, [products, selectedCategory, searchQuery]);

  // Add product to cart or increment if exists
  const addToCart = (product: ProductRecord) => {
    if (product.stock_quantity <= 0) return;

    setCart((prevCart) => {
      const existingIndex = prevCart.findIndex((item) => item.productId === product.product_id);
      const isDiscrete = ["piece", "packet", "bottle"].includes(product.unit.toLowerCase());
      const step = isDiscrete ? 1 : 1;

      if (existingIndex > -1) {
        const item = prevCart[existingIndex];
        const newQty = Math.min(product.stock_quantity, item.quantity + step);
        const updated = [...prevCart];
        updated[existingIndex] = {
          ...item,
          quantity: newQty,
          lineTotal: Math.round(newQty * item.unitPrice),
        };
        return updated;
      } else {
        const initialQty = 1;
        return [
          ...prevCart,
          {
            productId: product.product_id,
            name: product.name,
            unit: product.unit,
            unitPrice: product.selling_price,
            stockQuantity: product.stock_quantity,
            quantity: initialQty,
            lineTotal: Math.round(initialQty * product.selling_price),
          },
        ];
      }
    });
  };

  // Barcode / SKU quick-add on Enter key
  const handleBarcodeEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const exactMatch = products.find(
        (p) => p.sku && p.sku.toLowerCase() === q && p.stock_quantity > 0
      );
      if (exactMatch) {
        addToCart(exactMatch);
        setSearchQuery("");
      } else if (filteredProducts.length === 1 && filteredProducts[0].stock_quantity > 0) {
        addToCart(filteredProducts[0]);
        setSearchQuery("");
      }
    }
  };

  // Update item quantity
  const updateQuantity = (productId: string, rawVal: number) => {
    setCart((prevCart) => {
      return prevCart
        .map((item) => {
          if (item.productId !== productId) return item;
          const isDiscrete = ["piece", "packet", "bottle"].includes(item.unit.toLowerCase());
          let validQty = rawVal;
          if (isDiscrete) {
            validQty = Math.round(validQty);
          } else {
            validQty = Math.round(validQty * 1000) / 1000;
          }

          if (validQty <= 0) return null;
          const cappedQty = Math.min(item.stockQuantity, validQty);

          return {
            ...item,
            quantity: cappedQty,
            lineTotal: Math.round(cappedQty * item.unitPrice),
          };
        })
        .filter((item): item is CartItem => item !== null);
    });
  };

  // Remove single line item
  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((i) => i.productId !== productId));
  };

  // Clear entire cart
  const clearCart = () => {
    setCart([]);
    setDiscountRupees("");
    setCashTenderedRupees("");
    setCheckoutError(null);
  };

  // Computed totals in integer Paisa
  const grossSubtotalPaisa = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.lineTotal, 0);
  }, [cart]);

  const discountPaisa = useMemo(() => {
    const num = parseFloat(discountRupees);
    if (isNaN(num) || num <= 0) return 0;
    return Math.min(grossSubtotalPaisa, rupeesToPaisa(num));
  }, [discountRupees, grossSubtotalPaisa]);

  const netTotalPaisa = Math.max(0, grossSubtotalPaisa - discountPaisa);

  const cashTenderedPaisa = useMemo(() => {
    const num = parseFloat(cashTenderedRupees);
    if (isNaN(num) || num <= 0) return 0;
    return rupeesToPaisa(num);
  }, [cashTenderedRupees]);

  const changeDuePaisa = Math.max(0, cashTenderedPaisa - netTotalPaisa);

  // Handle Checkout submission
  const handleCheckout = async () => {
    if (cart.length === 0 || isSubmitting) return;

    setIsSubmitting(true);
    setCheckoutError(null);

    const idempotencyKey = crypto.randomUUID();

    const payload = {
      idempotency_key: idempotencyKey,
      items: cart.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
        unit_price_snapshot: item.unitPrice,
      })),
      discount_amount: discountPaisa,
      payment_method: "cash",
    };

    try {
      const res = await fetch("/api/sales", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data: { success: boolean; data?: SaleWithItemsRecord; error?: { message: string } } =
        await res.json();

      if (data.success && data.data) {
        setCompletedSale(data.data);
        setIsReceiptOpen(true);
        // Reset cart for next customer
        setCart([]);
        setDiscountRupees("");
        setCashTenderedRupees("");
        // Reload products so live stock counts are accurate
        refreshProducts();
      } else {
        setCheckoutError(data.error?.message || "Failed to process sale.");
      }
    } catch {
      setCheckoutError("Network error while recording sale. Please retry.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="pos-container">
      {/* POS Top Bar */}
      <div className="pos-header-bar">
        <div>
          <h1 className="pos-title">{t("salesRegister")}</h1>
          <p className="pos-subtitle">{t("salesSubtitle")}</p>
        </div>
        <div className="pos-date-badge">
          <Icon name="calendar" size={15} />
          <span>{todayDates.ad}</span>
          <span className="pos-date-divider">•</span>
          <span className="font-medium text-emerald-800">
            {formatBikramSambatDate(todayDates.bs, locale)}
          </span>
        </div>
      </div>

      {checkoutError && (
        <div className="pos-alert-error" role="alert">
          <Icon name="alertTriangle" size={18} />
          <span>{checkoutError}</span>
        </div>
      )}

      {/* Main 2-Column POS Layout */}
      <div className="pos-main-layout">
        {/* Left Column: Product Search & Quick Catalog */}
        <div className="pos-catalog-column">
          <div className="pos-search-card">
            <div className="pos-search-input-wrap">
              <Icon name="search" size={18} className="pos-search-icon" />
              <input
                ref={searchInputRef}
                type="text"
                className="pos-search-input"
                placeholder={t("searchProductsPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleBarcodeEnter}
                autoFocus
              />
              {searchQuery && (
                <button
                  type="button"
                  className="pos-search-clear"
                  onClick={() => setSearchQuery("")}
                  aria-label={t("closeModal")}
                >
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>

            {/* Category Pills */}
            <div className="pos-category-pills">
              <button
                type="button"
                className={`pos-pill ${selectedCategory === "all" ? "pos-pill-active" : ""}`}
                onClick={() => setSelectedCategory("all")}
              >
                {t("allCategories")}
              </button>
              {categories.map((cat) => (
                <button
                  type="button"
                  key={cat}
                  className={`pos-pill ${selectedCategory.toLowerCase() === cat.toLowerCase() ? "pos-pill-active" : ""}`}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Product Items Grid */}
          <div className="pos-product-grid-wrap">
            {loadingProducts ? (
              <div className="pos-loading-state">
                <Icon name="loader" size={24} className="animate-spin text-primary" />
                <p>{t("loading")}</p>
              </div>
            ) : productError ? (
              <div className="pos-alert-error">
                <Icon name="alertTriangle" size={18} />
                <span>{productError}</span>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="pos-empty-catalog">
                <Icon name="package" size={36} className="text-muted" />
                <p>{t("noProductsFound")}</p>
              </div>
            ) : (
              <div className="pos-product-grid">
                {filteredProducts.map((p) => {
                  const isOutOfStock = p.stock_quantity <= 0;
                  const isLowStock = !isOutOfStock && p.stock_quantity <= p.low_stock_threshold;
                  const inCartItem = cart.find((i) => i.productId === p.product_id);

                  return (
                    <button
                      type="button"
                      key={p.product_id}
                      className={`pos-product-card ${isOutOfStock ? "out-of-stock" : ""} ${inCartItem ? "in-cart" : ""}`}
                      onClick={() => !isOutOfStock && addToCart(p)}
                      disabled={isOutOfStock}
                    >
                      <div className="pos-card-top">
                        <span className="pos-product-name">{p.name}</span>
                        {inCartItem && (
                          <span className="pos-cart-badge">{inCartItem.quantity}</span>
                        )}
                      </div>
                      <div className="pos-card-meta">
                        <span className="pos-product-unit">{p.unit}</span>
                        {p.sku && <span className="pos-product-sku font-mono">{p.sku}</span>}
                      </div>
                      <div className="pos-card-bottom">
                        <span className="pos-product-price font-bold">
                          {formatPaisa(p.selling_price, locale)}
                        </span>
                        <span
                          className={`pos-stock-tag ${
                            isOutOfStock
                              ? "tag-danger"
                              : isLowStock
                              ? "tag-warning"
                              : "tag-normal"
                          }`}
                        >
                          {isOutOfStock
                            ? t("outOfStockOnly")
                            : `${p.stock_quantity} ${p.unit}`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Cart Register & Checkout */}
        <div className="pos-cart-column">
          <div className="pos-cart-card">
            <div className="pos-cart-header">
              <div className="flex items-center gap-2">
                <Icon name="sale" size={18} className="text-primary" />
                <h2 className="pos-cart-title">{t("cartTitle")}</h2>
                {cart.length > 0 && (
                  <span className="pos-cart-count-pill">{cart.length}</span>
                )}
              </div>
              {cart.length > 0 && (
                <button
                  type="button"
                  className="pos-cart-clear-btn"
                  onClick={clearCart}
                  title={t("clearCart")}
                >
                  <Icon name="trash" size={14} />
                  <span>{t("clearCart")}</span>
                </button>
              )}
            </div>

            {/* Cart Table / Items List */}
            <div className="pos-cart-items-wrap">
              {cart.length === 0 ? (
                <div className="pos-cart-empty">
                  <Icon name="sale" size={32} className="text-muted-soft opacity-60" />
                  <p>{t("emptyCart")}</p>
                </div>
              ) : (
                <div className="pos-cart-items-list">
                  {cart.map((item) => (
                    <div key={item.productId} className="pos-cart-item-row">
                      <div className="pos-item-info">
                        <div className="pos-item-title-wrap">
                          <span className="pos-item-title">{item.name}</span>
                          <span className="pos-item-unit-tag">{item.unit}</span>
                        </div>
                        <span className="pos-item-unit-price">
                          {formatPaisa(item.unitPrice, locale)} / {item.unit}
                        </span>
                      </div>

                      {/* Quantity Controller */}
                      <div className="pos-item-qty-control">
                        <button
                          type="button"
                          className="pos-qty-btn"
                          onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                          aria-label="Decrease quantity"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          step={["piece", "packet", "bottle"].includes(item.unit.toLowerCase()) ? "1" : "0.1"}
                          min="0.1"
                          max={item.stockQuantity}
                          className="pos-qty-input"
                          value={item.quantity}
                          onChange={(e) =>
                            updateQuantity(item.productId, parseFloat(e.target.value) || 0)
                          }
                        />
                        <button
                          type="button"
                          className="pos-qty-btn"
                          disabled={item.quantity >= item.stockQuantity}
                          onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>

                      {/* Line Total */}
                      <div className="pos-item-total">
                        <span className="font-bold">{formatPaisa(item.lineTotal, locale)}</span>
                        <button
                          type="button"
                          className="pos-item-del-btn"
                          onClick={() => removeFromCart(item.productId)}
                          aria-label="Remove item"
                        >
                          <Icon name="x" size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Financial Totals & Checkout Summary */}
            <div className="pos-cart-summary">
              <div className="pos-summary-row">
                <span className="text-muted">{t("subtotal")}</span>
                <span className="font-semibold">{formatPaisa(grossSubtotalPaisa, locale)}</span>
              </div>

              {/* Discount Input */}
              <div className="pos-summary-row items-center">
                <span className="text-muted">{t("discountPaisa")}</span>
                <div className="pos-input-affix-wrap">
                  <span className="pos-affix">रु</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    className="pos-summary-input"
                    value={discountRupees}
                    onChange={(e) => setDiscountRupees(e.target.value)}
                    disabled={cart.length === 0}
                  />
                </div>
              </div>

              {/* Net Total Display */}
              <div className="pos-summary-divider" />
              <div className="pos-summary-row pos-net-total-row">
                <span className="pos-net-total-label">{t("netTotal")}</span>
                <span className="pos-net-total-value">
                  {formatPaisa(netTotalPaisa, locale)}
                </span>
              </div>

              {/* Cash Received & Change Calculator */}
              <div className="pos-cash-tender-wrap">
                <div className="pos-summary-row items-center">
                  <span className="text-muted text-xs">{t("cashTendered")}</span>
                  <div className="pos-input-affix-wrap">
                    <span className="pos-affix">रु</span>
                    <input
                      type="number"
                      min="0"
                      placeholder={paisaToRupees(netTotalPaisa).toString()}
                      className="pos-summary-input"
                      value={cashTenderedRupees}
                      onChange={(e) => setCashTenderedRupees(e.target.value)}
                      disabled={cart.length === 0}
                    />
                  </div>
                </div>

                {cashTenderedPaisa > 0 && (
                  <div className="pos-summary-row text-xs mt-1">
                    <span className="text-muted">{t("changeDue")}</span>
                    <span
                      className={`font-bold ${
                        cashTenderedPaisa >= netTotalPaisa ? "text-emerald-700" : "text-danger"
                      }`}
                    >
                      {cashTenderedPaisa >= netTotalPaisa
                        ? formatPaisa(changeDuePaisa, locale)
                        : t("tenderShort")}
                    </span>
                  </div>
                )}
              </div>

              {/* Checkout Action Button */}
              <button
                type="button"
                className="btn-primary pos-checkout-btn"
                disabled={cart.length === 0 || isSubmitting}
                onClick={handleCheckout}
              >
                {isSubmitting ? (
                  <>
                    <Icon name="loader" size={18} className="animate-spin" />
                    <span>{t("saving")}</span>
                  </>
                ) : (
                  <>
                    <Icon name="check" size={18} />
                    <span>
                      {t("checkout")} • {formatPaisa(netTotalPaisa, locale)}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Printable Receipt Modal */}
      <ReceiptModal
        isOpen={isReceiptOpen}
        onClose={() => {
          setIsReceiptOpen(false);
          setCompletedSale(null);
        }}
        saleData={completedSale}
        cashTendered={cashTenderedPaisa}
      />
    </div>
  );
}
