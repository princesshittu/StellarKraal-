/**
 * Tests for the dark-mode toggle (ThemeToggle) — closes #1206.
 *
 * Covers:
 *  - Renders a button with an accessible label
 *  - aria-pressed reflects dark/light state
 *  - Keyboard activation (Enter, Space) triggers the toggle
 *  - Live-region announces state change to screen readers
 *  - localStorage preference is persisted on toggle
 *  - System preference (prefers-color-scheme) applied on first visit
 *  - User preference overrides system preference
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ThemeToggle from '../components/ThemeToggle';
import ThemeProvider, { ThemeScript, useTheme } from '../components/ThemeProvider';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockMatchMedia(matchesDark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: matchesDark && query.includes('dark'),
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }),
  });
}

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>
  );
}

function runThemeScript() {
  const { container } = render(<ThemeScript />);
  const script = container.querySelector('script')!.innerHTML;
  // eslint-disable-next-line no-eval
  eval(script);
}

// ── Basic rendering ───────────────────────────────────────────────────────────

describe('ThemeToggle — rendering (#1206)', () => {
  beforeEach(() => {
    mockMatchMedia(false);
    document.documentElement.classList.remove('dark');
    localStorage.clear();
  });

  it('renders a button element', () => {
    renderToggle();
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('has an accessible aria-label describing the action (light → dark)', () => {
    renderToggle();
    expect(
      screen.getByRole('button', { name: /switch to dark mode/i })
    ).toBeTruthy();
  });

  it('has an accessible aria-label describing the action (dark → light)', () => {
    document.documentElement.classList.add('dark');
    renderToggle();
    expect(
      screen.getByRole('button', { name: /switch to light mode/i })
    ).toBeTruthy();
  });
});

// ── aria-pressed ─────────────────────────────────────────────────────────────

describe('ThemeToggle — aria-pressed (#1206)', () => {
  beforeEach(() => {
    mockMatchMedia(false);
    document.documentElement.classList.remove('dark');
    localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.classList.remove('dark');
    localStorage.clear();
  });

  it('aria-pressed=false in light mode', () => {
    renderToggle();
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('aria-pressed=true in dark mode', () => {
    document.documentElement.classList.add('dark');
    renderToggle();
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('aria-pressed updates after toggle click', () => {
    renderToggle();
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });
});

// ── Keyboard accessibility ────────────────────────────────────────────────────

describe('ThemeToggle — keyboard accessibility (#1206)', () => {
  beforeEach(() => {
    mockMatchMedia(false);
    document.documentElement.classList.remove('dark');
    localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.classList.remove('dark');
    localStorage.clear();
  });

  it('is focusable via Tab key', async () => {
    renderToggle();
    await userEvent.tab();
    const btn = screen.getByRole('button');
    expect(btn).toHaveFocus();
  });

  it('activates on Enter key', async () => {
    renderToggle();
    const btn = screen.getByRole('button');
    btn.focus();
    await userEvent.keyboard('{Enter}');
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('activates on Space key', async () => {
    renderToggle();
    const btn = screen.getByRole('button');
    btn.focus();
    await userEvent.keyboard(' ');
    expect(localStorage.getItem('theme')).toBe('dark');
  });
});

// ── Live-region announcement ──────────────────────────────────────────────────

describe('ThemeToggle — live-region announcement (#1206)', () => {
  beforeEach(() => {
    mockMatchMedia(false);
    document.documentElement.classList.remove('dark');
    localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.classList.remove('dark');
    localStorage.clear();
  });

  it('renders a polite live region', () => {
    renderToggle();
    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
  });

  it('announces "Dark mode enabled" after switching to dark', async () => {
    renderToggle();
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(screen.getByRole('status')).toHaveTextContent(/dark mode enabled/i);
  });

  it('announces "Light mode enabled" after switching back to light', async () => {
    document.documentElement.classList.add('dark');
    renderToggle();
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(screen.getByRole('status')).toHaveTextContent(/light mode enabled/i);
  });
});

// ── localStorage persistence ──────────────────────────────────────────────────

describe('ThemeToggle — localStorage persistence (#1206)', () => {
  beforeEach(() => {
    mockMatchMedia(false);
    document.documentElement.classList.remove('dark');
    localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.classList.remove('dark');
    localStorage.clear();
  });

  it('writes "dark" to localStorage after toggling from light', () => {
    renderToggle();
    fireEvent.click(screen.getByRole('button'));
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('writes "light" to localStorage after toggling from dark', () => {
    document.documentElement.classList.add('dark');
    renderToggle();
    fireEvent.click(screen.getByRole('button'));
    expect(localStorage.getItem('theme')).toBe('light');
  });
});

// ── System preference / first visit ──────────────────────────────────────────

describe('ThemeToggle — system preference on first visit (#1206)', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark');
    localStorage.clear();
  });

  it('defaults to dark when OS prefers dark and nothing is stored', () => {
    mockMatchMedia(true);
    runThemeScript();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('defaults to light when OS prefers light and nothing is stored', () => {
    mockMatchMedia(false);
    runThemeScript();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('stored "dark" overrides a light system preference', () => {
    localStorage.setItem('theme', 'dark');
    mockMatchMedia(false);
    runThemeScript();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('stored "light" overrides a dark system preference', () => {
    localStorage.setItem('theme', 'light');
    mockMatchMedia(true);
    runThemeScript();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
