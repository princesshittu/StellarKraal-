"use client";
/**
 * LanguageSwitcher — Issue #1256
 *
 * A dropdown in the navigation bar that lets users switch between English
 * and Kiswahili. The selection is persisted via I18nContext (cookie +
 * localStorage) so it survives page reloads.
 *
 * Features:
 *  - Flag emoji + full language name displayed in the trigger button
 *  - Active language highlighted in the dropdown list
 *  - Keyboard navigable (ArrowUp/Down, Enter/Space to select, Escape to close)
 *  - Announces the selected language change via a live region
 *  - Works as a standalone component in both the top Navbar and MobileBottomNav
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { useI18n, SUPPORTED_LOCALES, type Locale } from "@/context/I18nContext";

// ── Locale metadata ────────────────────────────────────────────────────────────

const LOCALE_META: Record<Locale, { flag: string; name: string; nativeName: string }> = {
  en: { flag: "🇬🇧", name: "English", nativeName: "English" },
  sw: { flag: "🇹🇿", name: "Kiswahili", nativeName: "Kiswahili" },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const active = LOCALE_META[locale];

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Focus the active option when the dropdown opens
  useEffect(() => {
    if (!open) return;
    const activeIdx = SUPPORTED_LOCALES.indexOf(locale);
    optionRefs.current[activeIdx]?.focus();
  }, [open, locale]);

  function handleToggle() {
    setOpen((v) => !v);
  }

  function handleSelect(loc: Locale) {
    setLocale(loc);
    setOpen(false);
    buttonRef.current?.focus();
    // Announce the change to screen readers
    setAnnouncement(`Language changed to ${LOCALE_META[loc].name}`);
  }

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (!open) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
          e.preventDefault();
          setOpen(true);
        }
        return;
      }

      const currentIdx = SUPPORTED_LOCALES.findIndex(
        (loc) => optionRefs.current[SUPPORTED_LOCALES.indexOf(loc)] === document.activeElement
      );

      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = (currentIdx + 1) % SUPPORTED_LOCALES.length;
        optionRefs.current[next]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev =
          (currentIdx - 1 + SUPPORTED_LOCALES.length) % SUPPORTED_LOCALES.length;
        optionRefs.current[prev]?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        optionRefs.current[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        optionRefs.current[SUPPORTED_LOCALES.length - 1]?.focus();
      } else if (e.key === "Tab") {
        // Close on tab-out so focus moves naturally through the page
        setOpen(false);
      }
    },
    [open]
  );

  return (
    <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
      {/* ── Trigger button ────────────────────────────────────────────── */}
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Language: ${active.name}. Click to change`}
        onClick={handleToggle}
        className={[
          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium",
          "border border-[color:var(--color-border)]",
          "transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--token-accent)]",
          open
            ? "bg-[color:var(--color-border)] text-[color:var(--color-text)]"
            : "text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-border)] hover:text-[color:var(--color-text)]",
        ].join(" ")}
      >
        <span aria-hidden="true" className="text-base leading-none">
          {active.flag}
        </span>
        <span className="hidden sm:inline">{active.name}</span>
        <span className="sm:hidden text-xs font-semibold uppercase">
          {locale.toUpperCase()}
        </span>
        {/* Chevron */}
        <svg
          aria-hidden="true"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M2 4l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* ── Dropdown list ─────────────────────────────────────────────── */}
      {open && (
        <ul
          role="listbox"
          aria-label="Select language"
          aria-activedescendant={`lang-option-${locale}`}
          className={[
            "absolute right-0 mt-1 min-w-[10rem] rounded-xl shadow-lg z-50 py-1",
            "border border-[color:var(--color-border)]",
            "bg-[color:var(--color-bg-card)]",
          ].join(" ")}
        >
          {SUPPORTED_LOCALES.map((loc, idx) => {
            const meta = LOCALE_META[loc];
            const isActive = locale === loc;
            return (
              <li key={loc} role="option" aria-selected={isActive} id={`lang-option-${loc}`}>
                <button
                  ref={(el) => {
                    optionRefs.current[idx] = el;
                  }}
                  type="button"
                  onClick={() => handleSelect(loc)}
                  className={[
                    "w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left",
                    "transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--token-accent)]",
                    isActive
                      ? "bg-[color:var(--token-primary)]/10 text-[color:var(--token-primary)] font-semibold"
                      : "text-[color:var(--color-text)] hover:bg-[color:var(--color-border)]",
                  ].join(" ")}
                >
                  <span aria-hidden="true" className="text-xl leading-none">
                    {meta.flag}
                  </span>
                  <span className="flex-1">{meta.name}</span>
                  {/* Active check mark */}
                  {isActive && (
                    <svg
                      aria-hidden="true"
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                    >
                      <path
                        d="M3 8l3.5 3.5L13 5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Live region for screen-reader announcements ───────────────── */}
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
