"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import {
  type Locale,
  type Dictionary,
  defaultLocale,
  getDictionary,
  localeCookieName,
} from ".";

const LOCALE_STORAGE_KEY = "seconda-locale";
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

type I18nContextValue = {
  locale: Locale;
  t: Dictionary;
  setLocale: (locale: Locale) => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  initialLocale = defaultLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const t = useMemo(() => getDictionary(locale), [locale]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    document.documentElement.lang = locale;
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    document.cookie = `${localeCookieName}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
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
