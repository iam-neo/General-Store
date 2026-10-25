"use client";

import { useLocale } from "@/lib/i18n/locale-provider";

export function LanguageToggle() {
  const { locale, toggleLocale } = useLocale();
  const nextLanguage = locale === "en" ? "नेपाली" : "English";

  return (
    <button
      aria-label={`Switch language to ${nextLanguage}`}
      className="language-switch"
      onClick={toggleLocale}
      type="button"
    >
      {nextLanguage}
    </button>
  );
}
