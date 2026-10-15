'use client';

import React, { useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, ClipboardList, Beef, User } from 'lucide-react';
import { Icon } from '@/components/Icon';
import LanguageSwitcher from '@/components/LanguageSwitcher';

interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Loans', href: '/loans', icon: ClipboardList },
  { label: 'Collateral', href: '/collateral', icon: Beef },
  { label: 'Profile', href: '/profile', icon: User },
];

export default function MobileBottomNav() {
  const pathname = usePathname();
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;

    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    const start = current === -1 ? 0 : current;
    let next = start;
    if (event.key === 'ArrowRight') next = (start + 1) % NAV_ITEMS.length;
    if (event.key === 'ArrowLeft') next = (start - 1 + NAV_ITEMS.length) % NAV_ITEMS.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = NAV_ITEMS.length - 1;

    event.preventDefault();
    itemRefs.current[next]?.focus();
  }

  return (
    <nav
      className="mobile-bottom-nav fixed bottom-0 left-0 right-0 z-40 md:hidden border-t shadow-lg"
      aria-label="Mobile bottom navigation"
      onKeyDown={onKeyDown}
      style={{
        backgroundColor: 'var(--color-nav-bg)',
        borderColor: 'var(--color-nav-border)',
      }}
    >
      <div className="flex justify-around h-16">
        {NAV_ITEMS.map((item, index) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              aria-current={isActive ? 'page' : undefined}
              className="flex flex-1 flex-col items-center justify-center gap-1 min-h-[44px] min-w-[44px] text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--token-accent)]"
              style={{
                color: isActive ? 'var(--token-primary)' : 'var(--token-text-muted)',
              }}
            >
              <Icon icon={item.icon} size="md" className="text-current" />
              <span>{item.label}</span>
            </Link>
          );
        })}

        {/* Language switcher — #1256 */}
        <div className="flex flex-1 flex-col items-center justify-center gap-1 min-h-[44px] min-w-[44px]">
          <LanguageSwitcher />
        </div>
      </div>
    </nav>
  );
}
