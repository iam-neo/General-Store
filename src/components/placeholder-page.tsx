"use client";

import { Icon, type IconName } from "@/components/ui/icon";
import { useLocale } from "@/lib/i18n/locale-provider";

type PlaceholderSection =
  | "newSale"
  | "products"
  | "customers"
  | "transactions"
  | "credit"
  | "reports"
  | "settings";

const sectionIcons: Record<PlaceholderSection, IconName> = {
  newSale: "sale",
  products: "products",
  customers: "customers",
  transactions: "transactions",
  credit: "credit",
  reports: "reports",
  settings: "settings",
};

export function PlaceholderPage({ section }: Readonly<{ section: PlaceholderSection }>) {
  const { t } = useLocale();

  return (
    <section aria-labelledby="placeholder-title" className="placeholder-page">
      <p className="section-overline">{t("workspace")}</p>
      <h2 id="placeholder-title">{t(section)}</h2>
      <div className="placeholder-card">
        <span aria-hidden="true" className="placeholder-icon"><Icon name={sectionIcons[section]} size={23} /></span>
        <p className="placeholder-status">{t("comingSoon")}</p>
        <p className="placeholder-description">{t("comingSoonDescription")}</p>
        <p className="placeholder-note">{t("noChangesSaved")}</p>
      </div>
    </section>
  );
}
