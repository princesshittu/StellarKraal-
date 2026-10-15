"use client";

import Image from "next/image";
import StatusBadge from "@/components/StatusBadge";
import AppraisalChangeIndicator from "@/components/AppraisalChangeIndicator";
import { colors } from "@/lib/design-tokens";

export type CollateralItemStatus = "available" | "pledged" | "liquidated";

export interface CollateralStatusCardProps {
  /** Unique collateral ID shown in the footer */
  id: string;
  /** Animal type: "cattle" | "goat" | "sheep" (or any custom string) */
  animalType: string;
  /** Number of animals in this collateral item */
  count: number;
  /** Appraised value in stroops */
  appraisedValue: number;
  /**
   * Previous appraised value in stroops, used to compute the change indicator.
   * When `undefined` or `null` no indicator is shown (no prior appraisal).
   */
  previousAppraisedValue?: number | null;
  /** Collateral status — drives badge colour */
  status: CollateralItemStatus;
  /**
   * URL of the animal photo. When omitted, a themed placeholder avatar
   * is shown instead. The image is loaded lazily.
   */
  photoUrl?: string;
  /** Called when the card is clicked (e.g. navigate to detail page) */
  onClick?: () => void;
}

const ANIMAL_ICONS: Record<string, string> = {
  cattle: "🐄",
  goat: "🐐",
  sheep: "🐑",
};

const ANIMAL_LABEL: Record<string, string> = {
  cattle: "Cattle",
  goat: "Goat",
  sheep: "Sheep",
};

/** Format stroops as XLM with two decimal places, e.g. "1,234.56 XLM" */
function formatXlm(stroops: number): string {
  const xlm = stroops / 10_000_000;
  return `${xlm.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} XLM`;
}

/**
 * CollateralStatusCard
 *
 * A visual card representing a single collateral item in a borrower's
 * portfolio. Displays a photo (or placeholder), animal type badge, appraised
 * value, and status badge.
 *
 * Layout: responsive — full-width on mobile, one of three equal columns on
 * desktop (use inside a `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` container).
 *
 * Accessibility:
 * - Photo `alt` is generated from animal type and ID.
 * - Card is keyboard-focusable when `onClick` is provided.
 * - Status badge uses `role="status"` with an `aria-label` (from StatusBadge).
 */
export default function CollateralStatusCard({
  id,
  animalType,
  count,
  appraisedValue,
  previousAppraisedValue,
  status,
  photoUrl,
  onClick,
}: CollateralStatusCardProps) {
  const icon = ANIMAL_ICONS[animalType] ?? "🐾";
  const label = ANIMAL_LABEL[animalType] ?? animalType.charAt(0).toUpperCase() + animalType.slice(1);
  const altText = `${label} collateral ID ${id}`;
  const isInteractive = Boolean(onClick);

  return (
    <article
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={isInteractive ? onClick : undefined}
      onKeyDown={
        isInteractive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      aria-label={`${label} collateral, ${status}`}
      className={[
        // Base card shell
        "group rounded-2xl overflow-hidden border",
        colors.border ?? "border-gray-200 dark:border-gray-700",
        colors.background?.card ?? "bg-white dark:bg-gray-900",
        "shadow-sm",
        // Transitions
        "transition-all duration-200 ease-in-out",
        // Interactive states
        isInteractive
          ? [
              "cursor-pointer",
              "hover:shadow-lg hover:-translate-y-0.5",
              "active:scale-[0.99] active:shadow-md active:translate-y-0",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-2",
            ].join(" ")
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* ── Photo / Placeholder ──────────────────────────────────────── */}
      <div className="relative w-full aspect-[4/3] bg-gray-100 dark:bg-gray-800 overflow-hidden">
        {photoUrl ? (
          <Image
            src={photoUrl}
            alt={altText}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
            placeholder="blur"
            blurDataURL="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
          />
        ) : (
          /* Placeholder avatar — centred emoji on a tinted background */
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-amber-50 dark:bg-amber-950/30"
            aria-hidden="true"
          >
            <span className="text-6xl leading-none select-none" role="img" aria-label={label}>
              {icon}
            </span>
            <span className="text-xs font-medium text-amber-700 dark:text-amber-300 uppercase tracking-wider">
              No photo
            </span>
          </div>
        )}

        {/* Animal-type badge — overlaid on top-left of photo */}
        <div className="absolute top-2 left-2">
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-white/90 dark:bg-gray-900/90 text-gray-800 dark:text-gray-100 shadow-sm backdrop-blur-sm">
            <span aria-hidden="true">{icon}</span>
            {label}
          </span>
        </div>

        {/* Status badge — overlaid on top-right of photo */}
        <div className="absolute top-2 right-2">
          <StatusBadge status={status} />
        </div>
      </div>

      {/* ── Card body ────────────────────────────────────────────────── */}
      <div className="p-4 flex flex-col gap-2">
        {/* Appraised value */}
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Appraised value
          </p>
          <div className="flex items-baseline gap-2">
            <p className="text-lg font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
              {formatXlm(appraisedValue)}
            </p>
            <AppraisalChangeIndicator
              currentValue={appraisedValue}
              previousValue={previousAppraisedValue}
            />
          </div>
        </div>

        {/* Count */}
        <p className="text-sm text-gray-600 dark:text-gray-300">
          <span className="font-medium">{count}</span>{" "}
          {count === 1 ? label.toLowerCase() : `${label.toLowerCase()}s`}
        </p>

        {/* Collateral ID */}
        <p className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate" title={id}>
          ID: {id}
        </p>
      </div>
    </article>
  );
}
