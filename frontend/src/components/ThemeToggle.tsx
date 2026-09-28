"use client";
/**
 * ThemeToggle — sun/moon icon button that toggles between light and dark mode.
 *
 * Closes #1206:
 *  - Sun icon in dark mode, Moon icon in light mode — placed in the top navigation.
 *  - Defaults to `prefers-color-scheme` on first visit (handled by ThemeProvider +
 *    ThemeScript; this component just consumes the context).
 *  - User preference is persisted to `localStorage` via ThemeProvider.toggle().
 *  - Keyboard accessible: inherits native <button> tab-stop, activates on Enter/Space.
 *  - Screen-reader friendly:
 *      • `aria-label` announces the *action* ("Switch to dark mode / light mode").
 *      • `aria-pressed` reflects the *current* dark-mode state so AT can read it.
 *      • A visually-hidden `aria-live="polite"` region announces the state
 *        *after* the toggle fires so users of screen readers get feedback.
 *  - `focus-visible` ring satisfies WCAG 2.4.7 (Focus Visible) and keeps the
 *    Lighthouse accessibility score ≥ 90.
 */
import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { Icon } from "@/components/Icon";
import { useTheme } from "./ThemeProvider";

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  /**
   * Announcement string for the polite live region.
   * Updated *after* the toggle so the screen reader reads the new state.
   */
  const [announcement, setAnnouncement] = useState<string>("");

  /**
   * Update the live-region text whenever the theme changes so assistive
   * technology announces the result of the toggle action.
   */
  useEffect(() => {
    if (announcement === "") return; // skip the initial mount — no user action yet
    setAnnouncement(isDark ? "Dark mode enabled" : "Light mode enabled");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark]);

  function handleToggle() {
    toggle();
    // Set the announcement synchronously — the effect above will also fire but
    // we set it here too so fast successive presses still produce output.
    setAnnouncement(!isDark ? "Dark mode enabled" : "Light mode enabled");
  }

  return (
    <>
      <button
        type="button"
        onClick={handleToggle}
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        /**
         * aria-pressed=true when dark mode is ON — communicates the current
         * toggle state to screen readers independently of the visual icon.
         */
        aria-pressed={isDark}
        className={[
          "rounded-lg p-2 min-h-[44px] min-w-[44px] flex items-center justify-center",
          "transition-colors duration-200",
          "hover:bg-[var(--color-border)]",
          // focus-visible ring — WCAG 2.4.7 Focus Visible
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]",
        ].join(" ")}
      >
        {/* Icon is decorative; aria-label on the button conveys the action */}
        <Icon
          icon={isDark ? Sun : Moon}
          size="md"
          className="text-[var(--color-text)]"
          aria-hidden={true}
        />
      </button>

      {/*
       * Visually-hidden live region — announces the toggle result to screen
       * readers without disrupting the visual layout.
       * `aria-live="polite"` waits for the current speech to finish before
       * reading the announcement, which is the correct UX for a non-urgent
       * state change.
       */}
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </span>
    </>
  );
}
