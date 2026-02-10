import { zh } from "./dictionaries/zh";
import { en } from "./dictionaries/en";

export type Locale = "zh" | "en";

type DeepStringify<T> = T extends readonly (infer U)[]
  ? readonly DeepStringify<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepStringify<T[K]> }
    : T extends string
      ? string
      : T;

export type Dictionary = DeepStringify<typeof zh>;

export const defaultLocale: Locale = "zh";
export const locales: Locale[] = ["zh", "en"];
export const localeCookieName = "seconda-locale";

const dictionaries: Record<Locale, Dictionary> = { zh, en };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale] ?? dictionaries[defaultLocale];
}

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "zh" || value === "en";
}

export const localeNames: Record<Locale, string> = {
  zh: "中文",
  en: "English",
};
