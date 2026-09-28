import type { Metadata } from "next";
import CurrencySettings from "@/components/CurrencySettings";
import NotificationPreferences from "@/components/NotificationPreferences";
import DensityToggle from "@/components/DensityToggle";
import ToastPositionSelector from "@/components/ToastPositionSelector";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Settings — StellarKraal",
  description: "Configure your currency, notifications, and language preferences for StellarKraal.",
  alternates: { canonical: "https://stellarkraal.io/settings" },
  openGraph: {
    title: "Settings — StellarKraal",
    description: "Configure your currency, notifications, and language preferences for StellarKraal.",
    url: "https://stellarkraal.io/settings",
    images: [{ url: "https://stellarkraal.io/og-banner.png" }],
  },
};

export default function SettingsPage() {
  return (
    <main className="max-w-lg mx-auto px-4 py-10">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-brown/60 hover:text-brown text-sm">← Home</Link>
        <h1 className="text-3xl font-bold text-brown">Settings</h1>
      </div>
      <div className="space-y-8">
        <CurrencySettings />
        <DensityToggle />
        <NotificationPreferences />
        <ToastPositionSelector />
      </div>
    </main>
  );
}
