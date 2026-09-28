"use client";
/**
 * i18n Context — Issue #1207
 *
 * Lightweight, cookie-backed i18n for the StellarKraal frontend.
 * Supports English (en) and Kiswahili (sw) locales on the /loans and
 * /collateral pages, with the language switcher persisting selection to the
 * `stellarkraal_locale` cookie so the choice survives page reloads.
 *
 * Architecture choice: Next.js App Router does not support next-i18next's
 * page-level getServerSideProps pattern. This context provides an equivalent
 * client-side solution that is tree-shakeable and requires no additional
 * dependencies.
 */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Locale = "en" | "sw";

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, fallback?: string) => string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const SUPPORTED_LOCALES: Locale[] = ["en", "sw"];
export const DEFAULT_LOCALE: Locale = "en";
const COOKIE_NAME = "stellarkraal_locale";

// ─── Translation loader ───────────────────────────────────────────────────────

type TranslationDict = Record<string, unknown>;

/** Deeply resolve a dotted key path in a nested object. */
function resolvePath(obj: TranslationDict, path: string): string | undefined {
  const parts = path.split(".");
  let cursor: unknown = obj;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as TranslationDict)[part];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

/** Cache loaded translations to avoid redundant network fetches. */
const translationCache: Partial<Record<Locale, TranslationDict>> = {};

async function loadTranslations(locale: Locale): Promise<TranslationDict> {
  if (translationCache[locale]) return translationCache[locale]!;
  try {
    const res = await fetch(`/locales/${locale}/common.json`);
    if (!res.ok) throw new Error(`Failed to load locale: ${locale}`);
    const data = (await res.json()) as TranslationDict;
    translationCache[locale] = data;
    return data;
  } catch {
    // If sw fails to load, fall back to en
    if (locale !== DEFAULT_LOCALE) {
      return loadTranslations(DEFAULT_LOCALE);
    }
    return {};
  }
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────

function readLocaleCookie(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`)
  );
  const value = match ? decodeURIComponent(match[1]) : null;
  return (SUPPORTED_LOCALES as string[]).includes(value ?? "")
    ? (value as Locale)
    : DEFAULT_LOCALE;
}

function writeLocaleCookie(locale: Locale): void {
  if (typeof document === "undefined") return;
  // 1-year expiry, SameSite=Lax, no Secure flag needed (locale is not sensitive)
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${COOKIE_NAME}=${locale}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key: string, fallback?: string) => fallback ?? key,
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [translations, setTranslations] = useState<TranslationDict>({});

  // Hydrate locale from cookie on mount
  useEffect(() => {
    const saved = readLocaleCookie();
    setLocaleState(saved);
    loadTranslations(saved).then(setTranslations);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    writeLocaleCookie(next);
    loadTranslations(next).then(setTranslations);
  }, []);

  /** Resolve a dotted key such as "collateral.title" from the loaded dict. */
  const t = useCallback(
    (key: string, fallback?: string): string => {
      return resolvePath(translations, key) ?? fallback ?? key;
    },
    [translations]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
