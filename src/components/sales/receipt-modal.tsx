"use client";

import { useLocale } from "@/lib/i18n/locale-provider";
import { formatPaisa } from "@/lib/money/format";
import { formatBikramSambatDate } from "@/lib/date/nepali-calendar";
import { Icon } from "@/components/ui/icon";
import type { SaleWithItemsRecord } from "@/lib/server/apps-script/types";

type ReceiptModalProps = Readonly<{
  isOpen: boolean;
  onClose: () => void;
  saleData: SaleWithItemsRecord | null;
  cashTendered?: number; // In integer Paisa
}>;

export function ReceiptModal({
  isOpen,
  onClose,
  saleData,
  cashTendered,
}: ReceiptModalProps) {
  const { t, locale } = useLocale();

  if (!isOpen || !saleData) return null;

  const { sale, items } = saleData;

  const tenderPaisa = cashTendered !== undefined && cashTendered > 0 ? cashTendered : sale.total_amount;
  const changePaisa = Math.max(0, tenderPaisa - sale.total_amount);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="modal-container receipt-modal-container"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Actions Header (hidden during print) */}
        <div className="modal-header no-print">
          <div className="modal-title-wrap">
            <div className="modal-icon-badge receipt-badge">
              <Icon name="check" size={20} />
            </div>
            <div>
              <h3 className="modal-title">{t("saleSuccess")}</h3>
              <p className="modal-subtitle">{sale.receipt_number}</p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label={t("closeModal")}
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Printable Receipt Card */}
        <div className="receipt-scroll-wrap">
          <div className="receipt-paper" id="printable-receipt">
            <div className="receipt-header">
              <h2 className="receipt-store-title">{t("receiptStoreHeader")}</h2>
              <p className="receipt-store-sub">{t("receiptStoreAddress")}</p>
              <div className="receipt-divider-dashed" />
            </div>

            <div className="receipt-meta-grid">
              <div className="receipt-meta-row">
                <span className="receipt-meta-label">{t("receiptNumber")}:</span>
                <span className="receipt-meta-val font-mono">{sale.receipt_number}</span>
              </div>
              <div className="receipt-meta-row">
                <span className="receipt-meta-label">{t("receiptDate")}:</span>
                <span className="receipt-meta-val">{sale.transaction_date}</span>
              </div>
              <div className="receipt-meta-row">
                <span className="receipt-meta-label">{t("receiptDateBs")}:</span>
                <span className="receipt-meta-val font-medium">
                  {formatBikramSambatDate(sale.transaction_date_bs, locale)}
                </span>
              </div>
              <div className="receipt-meta-row">
                <span className="receipt-meta-label">{t("paymentMethod")}:</span>
                <span className="receipt-meta-val capitalize">{t("paymentCash")}</span>
              </div>
              <div className="receipt-meta-row">
                <span className="receipt-meta-label">Status:</span>
                <span className="receipt-meta-val text-emerald-700 font-bold uppercase text-xs">
                  {sale.status === "completed" ? t("statusCompleted") : sale.status}
                </span>
              </div>
            </div>

            <div className="receipt-divider-dashed" />

            {/* Line Items Table */}
            <table className="receipt-table">
              <thead>
                <tr>
                  <th className="text-left">Item</th>
                  <th className="text-center">Qty</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.sale_item_id}>
                    <td className="receipt-item-name">
                      <div>{it.product_name_snapshot}</div>
                      {(it.sku_snapshot || it.unit_snapshot) && (
                        <div className="receipt-item-meta text-xs text-muted">
                          {it.sku_snapshot && <span className="font-mono">{it.sku_snapshot} </span>}
                          {it.unit_snapshot && <span>({it.unit_snapshot})</span>}
                        </div>
                      )}
                    </td>
                    <td className="text-center">{it.quantity}</td>
                    <td className="text-right">{formatPaisa(it.unit_price_snapshot, locale)}</td>
                    <td className="text-right font-medium">{formatPaisa(it.line_total, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="receipt-divider-dashed" />

            {/* Summary Totals */}
            <div className="receipt-totals-list">
              <div className="receipt-total-row">
                <span>{t("subtotal")}:</span>
                <span>{formatPaisa(sale.subtotal, locale)}</span>
              </div>
              {sale.discount_amount > 0 && (
                <div className="receipt-total-row text-discount">
                  <span>{t("discount")}:</span>
                  <span>- {formatPaisa(sale.discount_amount, locale)}</span>
                </div>
              )}
              <div className="receipt-divider-solid" />
              <div className="receipt-total-row net-total-row">
                <span className="font-bold">{t("netTotal")}:</span>
                <span className="font-bold">{formatPaisa(sale.total_amount, locale)}</span>
              </div>
              {cashTendered !== undefined && cashTendered > 0 && (
                <>
                  <div className="receipt-total-row receipt-sub-row">
                    <span>{t("cashTendered")}:</span>
                    <span>{formatPaisa(tenderPaisa, locale)}</span>
                  </div>
                  <div className="receipt-total-row receipt-sub-row">
                    <span>{t("changeDue")}:</span>
                    <span>{formatPaisa(changePaisa, locale)}</span>
                  </div>
                </>
              )}
            </div>

            <div className="receipt-divider-dashed" />

            <div className="receipt-footer">
              <p className="receipt-thankyou">{t("thankYou")}</p>
              <p className="receipt-system-tag">General Store POS • {new Date().toLocaleTimeString()}</p>
            </div>
          </div>
        </div>

        {/* Modal Action Buttons (hidden in print) */}
        <div className="modal-actions-footer no-print">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
          >
            {t("newSaleAction")}
          </button>
          <button
            type="button"
            className="btn-primary btn-print"
            onClick={handlePrint}
          >
            <Icon name="printer" size={16} />
            <span>{t("printReceipt")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
