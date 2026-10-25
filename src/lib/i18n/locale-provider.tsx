"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { messages, type Locale, type MessageKey } from "@/lib/i18n/messages";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  t: (key: MessageKey) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);
const STORAGE_KEY = "general-store-locale";
const CHANGE_EVENT = "general-store-locale-change";

function subscribeToLocale(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getLocaleSnapshot(): Locale {
  return window.localStorage.getItem(STORAGE_KEY) === "ne" ? "ne" : "en";
}

function getServerLocaleSnapshot(): Locale {
  return "en";
}

export function LocaleProvider({ children }: Readonly<{ children: ReactNode }>) {
  const locale = useSyncExternalStore(
    subscribeToLocale,
    getLocaleSnapshot,
    getServerLocaleSnapshot,
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((nextLocale: Locale) => {
    window.localStorage.setItem(STORAGE_KEY, nextLocale);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === "en" ? "ne" : "en");
  }, [locale, setLocale]);

  const t = useCallback((key: MessageKey) => messages[locale][key], [locale]);
  const value = useMemo(
    () => ({ locale, setLocale, toggleLocale, t }),
    [locale, setLocale, toggleLocale, t],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used inside LocaleProvider");
  }
  return context;
}
