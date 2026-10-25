"use client";

import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/lib/i18n/locale-provider";

export function DemoDataNotice() {
  const { t } = useLocale();

  return (
    <aside aria-label={t("demoData")} className="demo-notice" role="note">
      <span className="demo-notice-icon"><Icon name="receipt" size={17} /></span>
      <span>
        <strong>{t("demoData")}</strong>
        <span>{t("demoDataDescription")}</span>
      </span>
    </aside>
  );
}
