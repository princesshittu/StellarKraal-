/**
 * HealthGauge stories — closes #1218
 *
 * Covers: default (safe), at-risk, critical, loading skeleton,
 * and chart mode with history time-series.
 */
import type { Meta, StoryObj } from '@storybook/react';
import HealthGauge from './HealthGauge';

const meta: Meta<typeof HealthGauge> = {
  title: 'Components/HealthGauge',
  component: HealthGauge,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Displays the health factor for a loan position. ' +
          '`value` is expressed in basis points (10 000 = 1.0). ' +
          'Pass `history` to enable chart mode with an interactive time-series. ' +
          'Pass `loading` to render a skeleton placeholder.',
      },
    },
  },
  argTypes: {
    value: {
      control: { type: 'number', min: 0, max: 30000, step: 100 },
      description: 'Health factor in basis points (10 000 = 1.0)',
    },
    loading: {
      control: 'boolean',
    },
  },
};

export default meta;
type Story = StoryObj<typeof HealthGauge>;

// ── Single-value states ───────────────────────────────────────────────────────

/** Health factor 2.4 — well above the 1.5 safe threshold. */
export const Safe: Story = {
  args: {
    value: 24_000,
  },
  parameters: {
    docs: {
      description: {
        story: 'Health factor 2.4 — green zone, well above the 1.5 safe threshold.',
      },
    },
  },
};

/** Health factor 1.3 — below 1.5, position is at risk. */
export const AtRisk: Story = {
  args: {
    value: 13_000,
  },
  parameters: {
    docs: {
      description: {
        story: 'Health factor 1.3 — amber zone, below the 1.5 warning threshold.',
      },
    },
  },
};

/** Health factor 0.9 — below 1.0, eligible for liquidation. */
export const Critical: Story = {
  args: {
    value: 9_000,
  },
  parameters: {
    docs: {
      description: {
        story: 'Health factor 0.9 — red zone, below 1.0 liquidation threshold.',
      },
    },
  },
};

/** Exactly at the 1.0 boundary — just barely solvent. */
export const BoundaryLiquidation: Story = {
  args: {
    value: 10_000,
  },
  parameters: {
    docs: {
      description: {
        story: 'Health factor exactly 1.0 — at the liquidation boundary.',
      },
    },
  },
};

/** Health factor 1.5 — exactly at the safe threshold. */
export const BoundarySafe: Story = {
  args: {
    value: 15_000,
  },
};

// ── Loading state ─────────────────────────────────────────────────────────────

/** Skeleton placeholder rendered while health factor data is loading. */
export const Loading: Story = {
  args: {
    value: 0,
    loading: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'When `loading` is true, a shimmer skeleton is rendered instead of the gauge.',
      },
    },
  },
};

// ── Chart mode (history) ─────────────────────────────────────────────────────

const generateHistory = (
  days: number,
  startBps: number,
  trend: number
) => {
  const now = Date.now();
  return Array.from({ length: days }, (_, i) => ({
    date: new Date(now - (days - i) * 86_400_000).toISOString(),
    value: Math.max(5_000, startBps + trend * i + Math.round((Math.random() - 0.5) * 500)),
  }));
};

/** Chart mode — 30-day history trending upward (recovering health factor). */
export const ChartRecovering: Story = {
  args: {
    value: 18_000,
    history: generateHistory(30, 10_000, 280),
  },
  parameters: {
    docs: {
      description: {
        story:
          '30-day history showing a recovering health factor (trending upward). ' +
          'Hover data points to reveal the tooltip.',
      },
    },
  },
};

/** Chart mode — 30-day history trending downward (deteriorating position). */
export const ChartDeteriorating: Story = {
  args: {
    value: 11_000,
    history: generateHistory(30, 24_000, -450),
  },
  parameters: {
    docs: {
      description: {
        story:
          '30-day history showing a deteriorating health factor (trending downward).',
      },
    },
  },
};

/** Chart mode with minimal history (2 data points). */
export const ChartMinimalHistory: Story = {
  args: {
    value: 16_000,
    history: [
      { date: new Date(Date.now() - 86_400_000).toISOString(), value: 14_000 },
      { date: new Date().toISOString(), value: 16_000 },
    ],
  },
};

/** Chart mode — loading state with history prop still provided. */
export const ChartLoading: Story = {
  args: {
    value: 0,
    loading: true,
    history: [],
  },
};
