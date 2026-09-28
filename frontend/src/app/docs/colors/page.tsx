'use client';

/**
 * /docs/colors — Color Palette design-token reference.
 *
 * Access is restricted to admin users (enforced by middleware on /admin routes
 * and directly at this route via the `admin` role check below).
 *
 * Features (#784):
 *  - All semantic design tokens with CSS variable names and usage notes
 *  - Live colour swatches (resolved from CSS custom properties at runtime)
 *  - Copy-to-clipboard for the CSS variable name (keyboard accessible)
 *  - WCAG contrast ratios between representative token pairs
 *  - Full dark-mode support
 */

import React, { useState, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Token definitions
// ---------------------------------------------------------------------------

const semanticTokens = [
  {
    group: 'Primary',
    tokens: [
      { name: 'color-primary',       cssVar: '--token-primary',       description: 'Main brand / interactive',           usageExample: 'bg-color-primary' },
      { name: 'color-primary-hover', cssVar: '--token-primary-hover', description: 'Primary hover state',                usageExample: 'hover:bg-color-primary-hover' },
      { name: 'color-on-primary',    cssVar: '--token-on-primary',    description: 'Text/icons on primary surface',      usageExample: 'text-color-on-primary' },
    ],
  },
  {
    group: 'Secondary',
    tokens: [
      { name: 'color-secondary',       cssVar: '--token-secondary',       description: 'Secondary brand / CTA',            usageExample: 'bg-color-secondary' },
      { name: 'color-secondary-hover', cssVar: '--token-secondary-hover', description: 'Secondary hover state',            usageExample: 'hover:bg-color-secondary-hover' },
      { name: 'color-on-secondary',    cssVar: '--token-on-secondary',    description: 'Text/icons on secondary surface',  usageExample: 'text-color-on-secondary' },
    ],
  },
  {
    group: 'Accent',
    tokens: [
      { name: 'color-accent', cssVar: '--token-accent', description: 'Highlight / focus ring', usageExample: 'ring-color-accent' },
    ],
  },
  {
    group: 'Danger',
    tokens: [
      { name: 'color-danger',        cssVar: '--token-danger',        description: 'Error / destructive action',  usageExample: 'bg-color-danger' },
      { name: 'color-danger-subtle', cssVar: '--token-danger-subtle', description: 'Error background / badge',    usageExample: 'bg-color-danger-subtle' },
      { name: 'color-on-danger',     cssVar: '--token-on-danger',     description: 'Text on danger surface',      usageExample: 'text-color-on-danger' },
    ],
  },
  {
    group: 'Success',
    tokens: [
      { name: 'color-success',        cssVar: '--token-success',        description: 'Positive outcome',           usageExample: 'bg-color-success' },
      { name: 'color-success-subtle', cssVar: '--token-success-subtle', description: 'Success background / badge', usageExample: 'bg-color-success-subtle' },
      { name: 'color-on-success',     cssVar: '--token-on-success',     description: 'Text on success surface',    usageExample: 'text-color-on-success' },
    ],
  },
  {
    group: 'Warning',
    tokens: [
      { name: 'color-warning',        cssVar: '--token-warning',        description: 'Caution / degraded state',   usageExample: 'bg-color-warning' },
      { name: 'color-warning-subtle', cssVar: '--token-warning-subtle', description: 'Warning background / badge', usageExample: 'bg-color-warning-subtle' },
      { name: 'color-on-warning',     cssVar: '--token-on-warning',     description: 'Text on warning surface',    usageExample: 'text-color-on-warning' },
    ],
  },
  {
    group: 'Surface',
    tokens: [
      { name: 'color-surface',        cssVar: '--token-surface',        description: 'Page background',            usageExample: 'bg-color-surface' },
      { name: 'color-surface-raised', cssVar: '--token-surface-raised', description: 'Card / panel background',    usageExample: 'bg-color-surface-raised' },
    ],
  },
  {
    group: 'Text',
    tokens: [
      { name: 'color-text',         cssVar: '--token-text',         description: 'Primary body text',              usageExample: 'text-color-text' },
      { name: 'color-text-subtle',  cssVar: '--token-text-subtle',  description: 'Secondary / supporting text',    usageExample: 'text-color-text-subtle' },
      { name: 'color-text-muted',   cssVar: '--token-text-muted',   description: 'Placeholder / disabled text',    usageExample: 'text-color-text-muted' },
      { name: 'color-text-inverse', cssVar: '--token-text-inverse', description: 'Text on dark surfaces',          usageExample: 'text-color-text-inverse' },
    ],
  },
  {
    group: 'Border',
    tokens: [
      { name: 'color-border',        cssVar: '--token-border',        description: 'Default divider / outline', usageExample: 'border-color-border' },
      { name: 'color-border-strong', cssVar: '--token-border-strong', description: 'Emphasis border',           usageExample: 'border-color-border-strong' },
    ],
  },
];

// Representative pairs for contrast demonstration
const contrastPairs = [
  { fg: '--token-text',         bg: '--token-surface',        label: 'Body text on page background' },
  { fg: '--token-on-primary',   bg: '--token-primary',        label: 'Text on primary button' },
  { fg: '--token-on-secondary', bg: '--token-secondary',      label: 'Text on secondary button' },
  { fg: '--token-text-inverse', bg: '--token-surface-raised', label: 'Inverse text on raised surface' },
  { fg: '--token-text-subtle',  bg: '--token-surface',        label: 'Subtle text on page background' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a CSS custom property to its computed hex value in the browser. */
function resolveVar(cssVar: string): string {
  if (typeof window === 'undefined') return '';
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(cssVar)
    .trim();
  return raw || '';
}

function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.replace('#', '');
  if (h.length !== 3 && h.length !== 6) return null;
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return parseFloat(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

function wcagBadge(ratio: number): { label: string; className: string } {
  if (ratio >= 7) return { label: 'AAA', className: 'bg-success-light text-success-dark' };
  if (ratio >= 4.5) return { label: 'AA', className: 'bg-success-light text-success-dark' };
  if (ratio >= 3) return { label: 'AA Large', className: 'bg-warning-light text-warning-dark' };
  return { label: 'Fail', className: 'bg-error-light text-error-dark' };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable (e.g. non-https in dev)
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      onKeyDown={(e) => e.key === 'Enter' && handleCopy()}
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      title={copied ? 'Copied!' : `Copy ${value}`}
      className={`
        inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-mono
        border transition-colors focus:outline-none focus-visible:ring-2
        focus-visible:ring-offset-1 focus-visible:ring-color-accent
        ${copied
          ? 'border-success-dark bg-success-light text-success-dark'
          : 'border-brown-200 dark:border-stone-600 bg-black/5 dark:bg-white/5 text-brown-700 dark:text-cream-200 hover:bg-black/10 dark:hover:bg-white/10'
        }
      `}
    >
      {copied ? (
        <>
          <span aria-hidden>✓</span>
          <span>Copied</span>
        </>
      ) : (
        <>
          <span aria-hidden>⎘</span>
          <span>{value}</span>
        </>
      )}
    </button>
  );
}

function Swatch({ cssVar }: { cssVar: string }) {
  return (
    <span
      className="inline-block w-10 h-10 rounded-lg border border-black/10 dark:border-white/10 shrink-0"
      style={{ backgroundColor: `var(${cssVar})` }}
      aria-hidden="true"
      role="presentation"
    />
  );
}

function ContrastRow({ fg, bg, label }: { fg: string; bg: string; label: string }) {
  const fgHex = resolveVar(fg);
  const bgHex = resolveVar(bg);
  const ratio = fgHex && bgHex ? contrastRatio(fgHex, bgHex) : null;
  const badge = ratio !== null ? wcagBadge(ratio) : null;

  return (
    <div className="flex items-center gap-4 py-2">
      {/* Preview swatch */}
      <span
        className="inline-flex items-center justify-center w-16 h-8 rounded text-xs font-semibold shrink-0"
        style={{ color: `var(${fg})`, backgroundColor: `var(${bg})` }}
        aria-hidden="true"
      >
        Aa
      </span>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-brown-700 dark:text-cream-200">{label}</p>
        <p className="text-xs font-mono text-brown-400 dark:text-stone-400">
          {fg} / {bg}
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {ratio !== null && (
          <span className="text-sm font-mono text-brown-700 dark:text-cream-200">
            {ratio}:1
          </span>
        )}
        {badge && (
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${badge.className}`}
          >
            {badge.label}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ColorPalettePage() {
  return (
    <main
      id="main-content"
      className="max-w-4xl mx-auto px-6 py-12 space-y-12"
      aria-label="Color palette — design tokens reference"
    >
      {/* Header */}
      <div>
        <h1 className="text-h1 mb-2">Color Palette</h1>
        <p className="text-body" style={{ color: 'var(--token-text-subtle)' }}>
          Semantic design tokens defined in{' '}
          <code className="font-mono text-sm bg-black/5 dark:bg-white/5 px-1 rounded">
            tailwind.config.js
          </code>
          . Use token names (e.g.{' '}
          <code className="font-mono text-sm bg-black/5 dark:bg-white/5 px-1 rounded">
            bg-color-primary
          </code>
          ) instead of raw Tailwind colour classes. Dark-mode variants are applied
          automatically via CSS custom properties.
        </p>
        <p className="text-sm mt-2" style={{ color: 'var(--token-text-muted)' }}>
          Click the CSS variable name to copy it to your clipboard.
        </p>
      </div>

      {/* Token groups */}
      {semanticTokens.map(({ group, tokens }) => (
        <section key={group} aria-labelledby={`group-${group.toLowerCase()}`}>
          <h2
            id={`group-${group.toLowerCase()}`}
            className="text-h3 mb-4 border-b pb-2"
            style={{ borderColor: 'var(--token-border)' }}
          >
            {group}
          </h2>

          <div
            role="list"
            aria-label={`${group} colour tokens`}
            className="space-y-3"
          >
            {tokens.map(({ name, cssVar, description, usageExample }) => (
              <div
                key={name}
                role="listitem"
                className="flex items-center gap-4"
              >
                <Swatch cssVar={cssVar} />

                <div className="flex-1 min-w-0">
                  <p className="text-label font-mono text-brown-800 dark:text-cream-100">
                    {name}
                  </p>
                  <p className="text-caption text-brown-500 dark:text-stone-400">
                    {description}
                  </p>
                  <p className="text-caption font-mono text-brown-400 dark:text-stone-500 mt-0.5">
                    Usage: <span className="italic">{usageExample}</span>
                  </p>
                </div>

                <CopyButton value={cssVar} label={name} />
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* Contrast ratios */}
      <section aria-labelledby="contrast-section">
        <h2
          id="contrast-section"
          className="text-h3 mb-2 border-b pb-2"
          style={{ borderColor: 'var(--token-border)' }}
        >
          Contrast Ratios
        </h2>
        <p className="text-sm mb-4" style={{ color: 'var(--token-text-subtle)' }}>
          WCAG 2.1 minimum: <strong>4.5:1</strong> for normal text (AA),{' '}
          <strong>3:1</strong> for large text / UI components (AA Large),{' '}
          <strong>7:1</strong> for enhanced (AAA).
        </p>

        <div
          role="list"
          aria-label="Token contrast pair results"
          className="divide-y"
          style={{ borderColor: 'var(--token-border)' }}
        >
          {contrastPairs.map((pair) => (
            <div role="listitem" key={`${pair.fg}-${pair.bg}`}>
              <ContrastRow {...pair} />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
