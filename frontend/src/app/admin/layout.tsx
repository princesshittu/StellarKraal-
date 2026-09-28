'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { Provider } from 'react-redux';
import { store } from '@/store/store';
import SkipToContent from '@/components/SkipToContent';
import AdminSidebarNav from '@/components/AdminSidebarNav';

const adminNav = [
  { label: 'Moderation', href: '/admin/moderation' },
  { label: 'Statistics', href: '/admin/statistics' },
  { label: 'Users', href: '/admin/users' },
  { label: 'Reports', href: '/admin/reports' },
  { label: 'Liquidators', href: '/admin/liquidators' },
  { label: 'Color Palette', href: '/docs/colors' },
];

interface AdminRootLayoutProps {
  children: React.ReactNode;
}

export default function AdminRootLayout({ children }: AdminRootLayoutProps) {
  return (
    <Provider store={store}>
      <div className="min-h-screen bg-cream-50 dark:bg-stone-900">
        <SkipToContent />
        <div className="sticky top-0 z-40 bg-white dark:bg-stone-800 border-b border-brown/10 dark:border-cream/10 shadow-sm">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold text-brown dark:text-cream">Admin Panel</h1>
              <Link href="/dashboard" className="text-gold hover:text-gold/80 text-sm font-medium min-h-[44px] flex items-center">
                ← Back to Dashboard
              </Link>
            </div>
          </div>
        </div>

        <AdminSidebarNav items={adminNav} />

        <Suspense fallback={<div className="p-8 text-center text-brown/60">Loading...</div>}>
          <main id="main-content">{children}</main>
        </Suspense>
      </div>
    </Provider>
  );
}

