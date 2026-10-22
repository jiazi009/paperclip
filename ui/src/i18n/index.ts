import i18n, { type InitOptions, type TOptions } from "i18next";
import { initReactI18next, useTranslation as useReactI18nextTranslation } from "react-i18next";

import { DEFAULT_LOCALE, i18nextResources, supportedLocales } from "./locales";
import { matchSupportedLocale as matchLocale, resolveLocalePreference } from "./locale-preference";

export const LOCALE_STORAGE_KEY = "paperclip.locale";
const RTL_LANGUAGES = new Set(["ar", "fa", "he", "ur"]);

function matchSupportedLocale(candidate: string) {
  return matchLocale(candidate, supportedLocales);
}

export function applyDocumentLocale(locale: string) {
  if (typeof document === "undefined") return;
  const resolved = matchSupportedLocale(locale) ?? DEFAULT_LOCALE;
  document.documentElement.lang = resolved;
  document.documentElement.dir = RTL_LANGUAGES.has(resolved.split("-")[0].toLowerCase()) ? "rtl" : "ltr";
}

function resolveInitialLocale(): string {
  let persisted: string | null = null;
  if (typeof window !== "undefined") {
    try {
      persisted = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {}
  }
  return resolveLocalePreference({
    persisted,
    defaultLocale: import.meta.env.VITE_DEFAULT_LOCALE,
    browserLanguages: typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language],
  }, supportedLocales, DEFAULT_LOCALE);
}

const initialLocale = resolveInitialLocale();

const i18nextOptions: InitOptions = {
  resources: i18nextResources,
  lng: initialLocale,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: supportedLocales,
  defaultNS: "translation",
  interpolation: { escapeValue: false },
  returnObjects: false,
  initAsync: false,
};

void i18n.use(initReactI18next).init(i18nextOptions).catch((error: unknown) => {
  console.error("Failed to initialize i18next", error);
});
applyDocumentLocale(initialLocale);
i18n.on("languageChanged", applyDocumentLocale);

export function t(key: string, options: TOptions = {}) {
  return i18n.t(key, options);
}

export function setLocale(locale: string) {
  if (!supportedLocales.includes(locale)) return;
  void i18n.changeLanguage(locale);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore storage failures.
  }
}

export const useTranslation = useReactI18nextTranslation;
export { i18n, supportedLocales };
