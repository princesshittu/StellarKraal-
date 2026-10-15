import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { usePathname } from 'next/navigation';
import MobileBottomNav from '@/components/MobileBottomNav';

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

// Mock I18nContext used by the embedded LanguageSwitcher
jest.mock('@/context/I18nContext', () => ({
  useI18n: () => ({ locale: 'en', setLocale: jest.fn() }),
  SUPPORTED_LOCALES: ['en', 'sw'],
}));

describe('MobileBottomNav', () => {
  beforeEach(() => {
    (usePathname as jest.Mock).mockReturnValue('/dashboard');
  });

  it('renders Dashboard, Loans, Collateral, and Profile', () => {
    render(<MobileBottomNav />);

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Loans')).toBeInTheDocument();
    expect(screen.getByText('Collateral')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
  });

  it('marks the active tab and highlights it with the primary colour', () => {
    render(<MobileBottomNav />);

    const dashboardLink = screen.getByRole('link', { name: /dashboard/i });
    expect(dashboardLink).toHaveAttribute('aria-current', 'page');
    expect(dashboardLink.getAttribute('style') || '').toMatch(/var\(--token-primary\)/);
  });

  it('does not mark inactive items as current', () => {
    render(<MobileBottomNav />);

    const loansLink = screen.getByRole('link', { name: /loans/i });
    expect(loansLink).not.toHaveAttribute('aria-current', 'page');
  });

  it('shows a label on every tab', () => {
    render(<MobileBottomNav />);

    for (const label of ['Dashboard', 'Loans', 'Collateral', 'Profile']) {
      expect(screen.getByText(label)).toBeVisible();
    }
  });

  it('renders icon elements with aria-hidden', () => {
    render(<MobileBottomNav />);

    const icons = document.querySelectorAll('[aria-hidden="true"]');
    // 4 nav item icons + language switcher decorative elements (flag span + chevron SVG)
    expect(icons.length).toBeGreaterThanOrEqual(4);
  });

  it('renders as a nav element with proper aria-label', () => {
    render(<MobileBottomNav />);

    expect(
      screen.getByRole('navigation', { name: 'Mobile bottom navigation' })
    ).toBeInTheDocument();
  });

  it('is fixed to the bottom and hidden from the md breakpoint up', () => {
    const { container } = render(<MobileBottomNav />);

    const nav = container.querySelector('nav');
    expect(nav).toHaveClass('fixed', 'bottom-0', 'left-0', 'right-0', 'md:hidden');
  });

  it('reserves iOS safe-area insets', () => {
    const { container } = render(<MobileBottomNav />);
    const nav = container.querySelector('nav');
    expect(nav).toHaveClass('mobile-bottom-nav');
  });

  it('moves focus across tabs with the keyboard', async () => {
    const user = userEvent.setup();
    render(<MobileBottomNav />);

    const dashboard = screen.getByRole('link', { name: /dashboard/i });
    const loans = screen.getByRole('link', { name: /loans/i });
    dashboard.focus();
    await user.keyboard('{ArrowRight}');
    expect(loans).toHaveFocus();

    await user.keyboard('{Home}');
    expect(dashboard).toHaveFocus();

    await user.keyboard('{End}');
    expect(screen.getByRole('link', { name: /profile/i })).toHaveFocus();
  });
});
