"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";
import { useLocale } from "@/lib/i18n/locale-provider";

const actions: ReadonlyArray<{
  href: string;
  titleKey: "createSale" | "addProduct" | "addCustomer" | "recordRepayment";
  icon: IconName;
}> = [
  { href: "/dashboard/sales", titleKey: "createSale", icon: "sale" },
  { href: "/dashboard/products", titleKey: "addProduct", icon: "products" },
  { href: "/dashboard/customers", titleKey: "addCustomer", icon: "customers" },
  { href: "/dashboard/credit", titleKey: "recordRepayment", icon: "credit" },
];

export function QuickActions() {
  const { t } = useLocale();

  return (
    <section aria-labelledby="quick-actions-title" className="quick-actions-panel">
      <div className="section-heading compact-heading">
        <div>
          <h2 id="quick-actions-title">{t("quickActions")}</h2>
          <p>{t("quickActionsDescription")}</p>
        </div>
      </div>
      <div className="quick-actions-grid">
        {actions.map((action) => (
          <Link className="quick-action" href={action.href} key={action.titleKey}>
            <span aria-hidden="true" className="quick-action-icon"><Icon name={action.icon} size={18} /></span>
            <span className="quick-action-label">{t(action.titleKey)}</span>
            <span aria-hidden="true" className="quick-action-arrow"><Icon name="arrow" size={15} /></span>
          </Link>
        ))}
      </div>
      <p className="quick-actions-note">{t("actionsNavigateToPlaceholder")}</p>
    </section>
  );
}
