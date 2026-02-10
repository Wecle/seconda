"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { type Locale, type Dictionary, defaultLocale, getDictionary } from ".";

const LOCALE_STORAGE_KEY = "seconda-locale";

type I18nContextValue = {
  locale: Locale;
  t: Dictionary;
  setLocale: (locale: Locale) => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function getInitialLocale(): Locale {
  if (typeof window === "undefined") return defaultLocale;
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (stored === "zh" || stored === "en") return stored;
  return defaultLocale;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);
  const [t, setT] = useState<Dictionary>(() => getDictionary(getInitialLocale()));

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    setT(getDictionary(newLocale));
    localStorage.setItem(LOCALE_STORAGE_KEY, newLocale);
  }, []);

  return (
    <I18nContext value={{ locale, t, setLocale }}>
      {children}
    </I18nContext>
  );
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useTranslation must be used within I18nProvider");
  }
  return context;
}
