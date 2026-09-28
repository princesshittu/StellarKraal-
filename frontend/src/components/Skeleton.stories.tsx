/**
 * Skeleton stories — closes #1218
 *
 * Covers: all built-in variants (text, heading, avatar, card, button, badge,
 * circle, custom), loading/error composite patterns, and accessibility notes.
 *
 * The `SkeletonVariant` union is defined here because the Skeleton component
 * references it without exporting it — see Skeleton.tsx.
 */
import type { Meta, StoryObj } from '@storybook/react';
import Skeleton from './Skeleton';

type SkeletonVariant =
  | 'text'
  | 'heading'
  | 'avatar'
  | 'card'
  | 'button'
  | 'badge'
  | 'circle'
  | 'custom';

const meta: Meta<typeof Skeleton> = {
  title: 'Components/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
**Skeleton** renders an animated shimmer placeholder for content that is loading for the first time.

### Usage rules
- Use **Skeleton** for initial page/section entry when there is no existing data yet.
- Use **Spinner** for inline action feedback (button clicks, filter changes).
- Use **ProgressBar** for file-upload progress.

### Accessibility
- Each \`<Skeleton />\` bar is \`aria-hidden="true"\` (decorative).
- Wrap one or more bars in a container with \`aria-busy="true"\` and an \`aria-label\` describing what is loading.

See \`LoadingStates.stories.tsx\` for full hierarchy examples.
        `.trim(),
      },
    },
  },
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'text',
        'heading',
        'avatar',
        'card',
        'button',
        'badge',
        'circle',
        'custom',
      ] as SkeletonVariant[],
      description: 'Visual variant — controls default dimensions and border-radius.',
    },
    className: {
      control: 'text',
      description: 'Additional Tailwind classes merged after the variant defaults.',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Skeleton>;

// ── Individual variants ───────────────────────────────────────────────────────

/** Full-width line of body text. */
export const Text: Story = {
  args: { variant: 'text' },
};

/** Wider, taller placeholder for a section heading. */
export const Heading: Story = {
  args: { variant: 'heading' },
};

/** Square rounded avatar (48 × 48 px). */
export const Avatar: Story = {
  args: { variant: 'avatar' },
};

/** Card-shaped block for data card placeholders. */
export const Card: Story = {
  args: { variant: 'card' },
};

/** Button-shaped placeholder (96 × 40 px). */
export const ButtonSkeleton: Story = {
  name: 'Button',
  args: { variant: 'button' },
};

/** Pill-shaped placeholder for status badges. */
export const Badge: Story = {
  args: { variant: 'badge' },
};

/** Circle placeholder for icon buttons or status dots. */
export const Circle: Story = {
  args: { variant: 'circle' },
};

/** Custom variant — dimensions supplied via `className`. */
export const Custom: Story = {
  args: { variant: 'custom', className: 'h-20 w-40 rounded-2xl' },
  parameters: {
    docs: {
      description: {
        story:
          '`custom` variant has no built-in size; pass arbitrary Tailwind classes via `className`.',
      },
    },
  },
};

// ── All variants side by side ─────────────────────────────────────────────────

const ALL_VARIANTS: SkeletonVariant[] = [
  'text',
  'heading',
  'avatar',
  'card',
  'button',
  'badge',
  'circle',
];

/** Quick visual comparison of all built-in variants. */
export const AllVariants: Story = {
  render: () => (
    <div
      className="space-y-4"
      aria-busy="true"
      aria-label="Loading all skeleton variants"
    >
      {ALL_VARIANTS.map((v) => (
        <div key={v} className="flex items-center gap-3">
          <span className="text-xs text-brown-400 w-16 shrink-0">{v}</span>
          <Skeleton variant={v} />
        </div>
      ))}
    </div>
  ),
};

// ── Composite patterns ────────────────────────────────────────────────────────

/** Simulates a loan card skeleton — heading + two text lines + badge. */
export const LoanCardSkeleton: Story = {
  render: () => (
    <div
      className="rounded-xl border border-brown-100 dark:border-brown-700 p-4 space-y-3 w-80"
      aria-busy="true"
      aria-label="Loading loan card"
    >
      <div className="flex items-center gap-3">
        <Skeleton variant="circle" />
        <Skeleton variant="heading" className="flex-1" />
      </div>
      <Skeleton variant="text" />
      <Skeleton variant="text" className="w-2/3" />
      <div className="flex gap-2 pt-1">
        <Skeleton variant="badge" />
        <Skeleton variant="button" />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Composite skeleton that mirrors the shape of a loan card. ' +
          'Uses `aria-busy="true"` and `aria-label` on the container.',
      },
    },
  },
};

/** Simulates a collateral row skeleton. */
export const CollateralRowSkeleton: Story = {
  render: () => (
    <div
      className="flex items-center gap-4 py-3 px-4 rounded-xl border border-brown-100 dark:border-brown-700 w-full"
      aria-busy="true"
      aria-label="Loading collateral row"
    >
      <Skeleton variant="avatar" />
      <div className="flex-1 space-y-2">
        <Skeleton variant="heading" className="w-1/2" />
        <Skeleton variant="text" className="w-3/4" />
      </div>
      <Skeleton variant="badge" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Composite skeleton mirroring a collateral list row.',
      },
    },
  },
};

/** Dark mode — all variants on a dark background. */
export const DarkMode: Story = {
  render: () => (
    <div
      className="dark bg-brown-900 p-6 rounded-2xl space-y-4"
      aria-busy="true"
      aria-label="Loading (dark mode)"
    >
      {ALL_VARIANTS.map((v) => (
        <div key={v} className="flex items-center gap-3">
          <span className="text-xs text-brown-400 w-16 shrink-0">{v}</span>
          <Skeleton variant={v} />
        </div>
      ))}
    </div>
  ),
};
