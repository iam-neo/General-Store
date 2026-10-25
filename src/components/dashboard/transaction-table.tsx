"use client";

import type { DemoTransaction } from "@/features/dashboard/types";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/lib/i18n/locale-provider";
import { formatNpr } from "@/lib/money/format";

export function TransactionTable({
  transactions,
}: Readonly<{ transactions: readonly DemoTransaction[] }>) {
  const { t } = useLocale();

  if (transactions.length === 0) {
    return (
      <div className="table-empty-state">
        <span aria-hidden="true" className="table-empty-icon"><Icon name="transactions" size={20} /></span>
        <strong>{t("emptyTransactions")}</strong>
        <span>{t("emptyTransactionsDescription")}</span>
      </div>
    );
  }

  return (
    <div className="table-scroll" role="region" aria-label={t("recentTransactions")} tabIndex={0}>
      <table className="transaction-table">
        <thead>
          <tr>
            <th scope="col">{t("transactionId")}</th>
            <th scope="col">{t("customer")}</th>
            <th scope="col">{t("date")}</th>
            <th scope="col">{t("paymentMethod")}</th>
            <th className="amount-cell" scope="col">{t("total")}</th>
            <th scope="col">{t("status")}</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => (
            <tr key={transaction.id}>
              <td className="transaction-id">{transaction.id}</td>
              <td className="customer-name" title={transaction.customerName}>{transaction.customerName}</td>
              <td className="transaction-date">{transaction.occurredAtLabel}</td>
              <td>
                {transaction.method === "esewa"
                  ? t("esewaDemo")
                  : transaction.method === "credit"
                    ? t("creditMethod")
                    : t("cash")}
              </td>
              <td className="amount-cell">{formatNpr(transaction.amountPaisa)}</td>
              <td><TransactionStatus status={transaction.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TransactionStatus({ status }: Readonly<{ status: DemoTransaction["status"] }>) {
  const { t } = useLocale();
  const statusClass = {
    paid: "status-badge status-paid",
    creditDue: "status-badge status-credit",
    pending: "status-badge status-pending",
  }[status];

  return <span className={statusClass}>{t(status)}</span>;
}
