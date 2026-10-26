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
  SaleRecord,
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

  // Tab State: Register vs History
  const [activeTab, setActiveTab] = useState<"register" | "history">("register");

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
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [completedSale, setCompletedSale] = useState<SaleWithItemsRecord | null>(null);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);

  // Sales History State
  const [salesHistory, setSalesHistory] = useState<readonly SaleRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [fetchingSaleId, setFetchingSaleId] = useState<string | null>(null);

  // Current dual dates
  const todayDates = useMemo(() => getTodayDualDates(), []);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const [refreshCount, setRefreshCount] = useState(0);

  const refreshProducts = useCallback(() => {
    setLoadingProducts(true);
    setRefreshCount((c) => c + 1);
  }, []);

  const loadSalesHistory = useCallback(() => {
    setLoadingHistory(true);
    setHistoryError(null);
    fetch("/api/sales?limit=50", {
      headers: { Accept: "application/json" },
    })
      .then((res) => res.json())
      .then((data: { success: boolean; data?: readonly SaleRecord[]; error?: { message: string } }) => {
        if (data.success && data.data) {
          setSalesHistory(data.data);
        } else {
          setHistoryError(data.error?.message || "Failed to load sales history.");
        }
        setLoadingHistory(false);
      })
      .catch(() => {
        setHistoryError("Network error while loading sales history.");
        setLoadingHistory(false);
      });
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

  const handleViewSaleReceipt = async (saleId: string) => {
    setFetchingSaleId(saleId);
    try {
      const res = await fetch(`/api/sales/${saleId}`, {
        headers: { Accept: "application/json" },
      });
      const data: { success: boolean; data?: SaleWithItemsRecord; error?: { message: string } } =
        await res.json();
      if (data.success && data.data) {
        setCompletedSale(data.data);
        setIsReceiptOpen(true);
      }
    } catch {
      // ignore
    } finally {
      setFetchingSaleId(null);
    }
  };

  // Filtered products list for POS catalog
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (selectedCategory !== "all" && p.category.toLowerCase() !== selectedCategory.toLowerCase()) {
        return false;
      }
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

  // Trigger checkout confirmation
  const handleOpenCheckoutConfirm = () => {
    if (cart.length === 0 || isSubmitting) return;
    setShowConfirmModal(true);
  };

  // Handle Checkout submission
  const handleCheckout = async () => {
    if (cart.length === 0 || isSubmitting) return;

    setIsSubmitting(true);
    setShowConfirmModal(false);
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
        // Also refresh sales history in background
        loadSalesHistory();
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
        <div className="flex items-center gap-3">
          <span className="pos-cash-badge">
            <Icon name="check" size={13} />
            <span>{t("cashOnlyNotice")}</span>
          </span>
          <div className="pos-date-badge">
            <Icon name="calendar" size={15} />
            <span>{todayDates.ad}</span>
            <span className="pos-date-divider">•</span>
            <span className="font-medium text-emerald-800">
              {formatBikramSambatDate(todayDates.bs, locale)}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs Switcher: POS Register vs Sales History */}
      <div className="pos-tabs-bar">
        <button
          type="button"
          className={`pos-tab-btn ${activeTab === "register" ? "active" : ""}`}
          onClick={() => setActiveTab("register")}
        >
          <Icon name="sale" size={16} />
          <span>{t("posTab")}</span>
        </button>
        <button
          type="button"
          className={`pos-tab-btn ${activeTab === "history" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("history");
            loadSalesHistory();
          }}
        >
          <Icon name="receipt" size={16} />
          <span>{t("historyTab")}</span>
          {salesHistory.length > 0 && (
            <span className="pos-cart-count-pill">{salesHistory.length}</span>
          )}
        </button>
      </div>

      {checkoutError && (
        <div className="pos-alert-error" role="alert">
          <Icon name="alertTriangle" size={18} />
          <span>{checkoutError}</span>
        </div>
      )}

      {/* Tab 1: POS Register */}
      {activeTab === "register" && (
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
                  onClick={handleOpenCheckoutConfirm}
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
      )}

      {/* Tab 2: Sales History */}
      {activeTab === "history" && (
        <div className="pos-history-card">
          <div className="pos-history-header">
            <div className="flex items-center gap-3">
              <Icon name="receipt" size={20} className="text-primary" />
              <h2 className="pos-history-title">{t("salesHistory")}</h2>
              {salesHistory.length > 0 && (
                <span className="pos-cart-count-pill">{salesHistory.length}</span>
              )}
            </div>
            <button
              type="button"
              className="btn-secondary flex items-center gap-2 text-xs"
              onClick={loadSalesHistory}
              disabled={loadingHistory}
            >
              <Icon name="loader" size={14} className={loadingHistory ? "animate-spin" : ""} />
              <span>{t("refresh")}</span>
            </button>
          </div>

          {loadingHistory ? (
            <div className="pos-loading-state">
              <Icon name="loader" size={24} className="animate-spin text-primary" />
              <p>{t("loading")}</p>
            </div>
          ) : historyError ? (
            <div className="pos-alert-error m-4">
              <Icon name="alertTriangle" size={18} />
              <span>{historyError}</span>
            </div>
          ) : salesHistory.length === 0 ? (
            <div className="pos-history-empty">
              <Icon name="receipt" size={36} className="text-muted opacity-60" />
              <p>{t("noSalesFound")}</p>
            </div>
          ) : (
            <div className="pos-history-table-wrap">
              <table className="pos-history-table">
                <thead>
                  <tr>
                    <th>{t("receiptNumber")}</th>
                    <th>{t("receiptDate")}</th>
                    <th>{t("receiptDateBs")}</th>
                    <th>{t("paymentMethod")}</th>
                    <th className="text-right">{t("totalAmount")}</th>
                    <th className="text-center">Status</th>
                    <th className="text-right">{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {salesHistory.map((s) => (
                    <tr key={s.sale_id}>
                      <td className="font-mono font-semibold">{s.receipt_number}</td>
                      <td>{s.transaction_date}</td>
                      <td className="font-medium text-emerald-800">
                        {formatBikramSambatDate(s.transaction_date_bs, locale)}
                      </td>
                      <td className="capitalize">
                        <span className="pos-cash-badge">
                          <Icon name="check" size={11} /> {s.payment_method || "cash"}
                        </span>
                      </td>
                      <td className="text-right font-bold">
                        {formatPaisa(s.total_amount, locale)}
                      </td>
                      <td className="text-center">
                        <span
                          className={`pos-stock-tag ${
                            s.status === "completed"
                              ? "tag-normal"
                              : s.status === "pending"
                              ? "tag-warning"
                              : "tag-danger"
                          }`}
                        >
                          {s.status === "completed" ? t("statusCompleted") : s.status}
                        </span>
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="btn-secondary text-xs inline-flex items-center gap-1.5 py-1 px-2.5"
                          disabled={fetchingSaleId === s.sale_id}
                          onClick={() => handleViewSaleReceipt(s.sale_id)}
                        >
                          {fetchingSaleId === s.sale_id ? (
                            <Icon name="loader" size={13} className="animate-spin" />
                          ) : (
                            <Icon name="printer" size={13} />
                          )}
                          <span>{t("viewReceipt")}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal before Checkout */}
      {showConfirmModal && (
        <div
          className="modal-backdrop"
          onClick={() => !isSubmitting && setShowConfirmModal(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="modal-container pos-confirm-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title-wrap">
                <div className="modal-icon-badge">
                  <Icon name="check" size={20} />
                </div>
                <div>
                  <h3 className="modal-title">{t("confirmCheckoutTitle")}</h3>
                  <p className="modal-subtitle">{t("confirmCheckoutMsg")}</p>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => !isSubmitting && setShowConfirmModal(false)}
                aria-label={t("closeModal")}
                disabled={isSubmitting}
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            <div className="pos-confirm-summary">
              <div className="pos-confirm-row">
                <span className="text-muted">{t("itemsCount")}:</span>
                <span className="font-semibold">
                  {cart.reduce((s, i) => s + i.quantity, 0)} ({cart.length} {t("itemsCount").toLowerCase()})
                </span>
              </div>
              <div className="pos-confirm-row">
                <span className="text-muted">{t("subtotal")}:</span>
                <span>{formatPaisa(grossSubtotalPaisa, locale)}</span>
              </div>
              {discountPaisa > 0 && (
                <div className="pos-confirm-row text-discount">
                  <span className="text-muted">{t("discount")}:</span>
                  <span>- {formatPaisa(discountPaisa, locale)}</span>
                </div>
              )}
              <div className="pos-confirm-divider" />
              <div className="pos-confirm-row">
                <span className="font-bold text-base">{t("netTotal")}:</span>
                <span className="font-bold text-lg text-primary-dark">
                  {formatPaisa(netTotalPaisa, locale)}
                </span>
              </div>
              {cashTenderedPaisa > 0 && (
                <>
                  <div className="pos-confirm-row text-xs mt-1">
                    <span className="text-muted">{t("cashTendered")}:</span>
                    <span>{formatPaisa(cashTenderedPaisa, locale)}</span>
                  </div>
                  <div className="pos-confirm-row text-xs">
                    <span className="text-muted">{t("changeDue")}:</span>
                    <span className="font-bold text-emerald-700">
                      {formatPaisa(changeDuePaisa, locale)}
                    </span>
                  </div>
                </>
              )}
              <div className="mt-2">
                <span className="pos-cash-badge">
                  <Icon name="check" size={12} /> {t("cashOnlyNotice")}
                </span>
              </div>
            </div>

            <div className="modal-actions-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowConfirmModal(false)}
                disabled={isSubmitting}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleCheckout}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Icon name="loader" size={16} className="animate-spin" />
                    <span>{t("saving")}</span>
                  </>
                ) : (
                  <>
                    <Icon name="check" size={16} />
                    <span>
                      {t("checkout")} • {formatPaisa(netTotalPaisa, locale)}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

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

