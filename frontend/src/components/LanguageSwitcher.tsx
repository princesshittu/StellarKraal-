"use client";
/**
 * LanguageSwitcher — Issue #1207
 *
 * Displays a compact toggle between English (EN) and Kiswahili (SW).
 * The selection is persisted to the `stellarkraal_locale` cookie via
 * the I18nContext so it survives page reloads and is applied globally.
 */
import { useI18n, SUPPORTED_LOCALES, type Locale } from "@/context/I18nContext";

const LOCALE_LABELS: Record<Locale, string> = {
  en: "EN",
  sw: "SW",
};

const LOCALE_FULL_LABELS: Record<Locale, string> = {
  en: "English",
  sw: "Kiswahili",
};

export default function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();

  return (
    <div
      role="group"
      aria-label="Language selector"
      className="flex items-center rounded-lg border border-[color:var(--color-border)] overflow-hidden"
    >
      {SUPPORTED_LOCALES.map((loc) => {
        const active = locale === loc;
        return (
          <button
            key={loc}
            type="button"
            onClick={() => setLocale(loc)}
            aria-label={`Switch to ${LOCALE_FULL_LABELS[loc]}`}
            aria-pressed={active}
            title={LOCALE_FULL_LABELS[loc]}
            className={[
              "px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--token-accent)]",
              active
                ? "bg-[color:var(--token-primary)] text-white"
                : "text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-border)] hover:text-[color:var(--color-text)]",
            ].join(" ")}
          >
            {LOCALE_LABELS[loc]}
          </button>
        );
      })}
    </div>
  );
}
