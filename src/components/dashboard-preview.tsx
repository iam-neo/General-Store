"use client";

import { QuickActions } from "@/components/dashboard/quick-actions";
import { StatCard } from "@/components/dashboard/stat-card";
import { TransactionTable } from "@/components/dashboard/transaction-table";
import { demoSummary, demoTransactions } from "@/features/dashboard/mock-data";
import { formatNpr } from "@/lib/money/format";
import { useLocale } from "@/lib/i18n/locale-provider";

export function DashboardPreview() {
  const { t } = useLocale();
  const summaryCards = [
    { label: "todaySales", amount: demoSummary.salesTodayPaisa, description: "salesCardHint", icon: "sale" },
    { label: "cashReceived", amount: demoSummary.cashReceivedPaisa, description: "cashCardHint", icon: "cash" },
    { label: "digitalPayments", amount: demoSummary.digitalPaymentsPaisa, description: "digitalCardHint", icon: "digital" },
    { label: "creditSalesToday", amount: demoSummary.creditSalesTodayPaisa, description: "creditCardHint", icon: "credit" },
    { label: "outstandingDues", amount: demoSummary.outstandingDuesPaisa, description: "duesCardHint", icon: "dues" },
  ] as const;

  return (
    <div className="dashboard-overview">
      <div className="overview-intro">
        <div>
          <h2>{t("dashboardTitle")}</h2>
          <p>{t("dashboardSubtitle")}</p>
        </div>
        <span className="sample-day"><span aria-hidden="true">◷</span>{t("sampleDay")}</span>
      </div>

      <section aria-label={t("dashboardTitle")} className="summary-grid">
        {summaryCards.map((card) => (
          <StatCard
            amount={formatNpr(card.amount)}
            description={t(card.description)}
            icon={card.icon}
            key={card.label}
            label={t(card.label)}
          />
        ))}
      </section>

      <div className="dashboard-lower-grid">
        <section aria-labelledby="recent-transactions-title" className="content-panel transactions-panel">
          <div className="panel-heading">
            <div>
              <h2 id="recent-transactions-title">{t("recentTransactions")}</h2>
              <p>{t("sampleRecords")}</p>
            </div>
            <span className="sample-tag">{t("demoData")}</span>
          </div>
          <TransactionTable transactions={demoTransactions} />
        </section>

        <QuickActions />
      </div>
    </div>
  );
}
