/**
 * SearchFilterBar stories — closes #1218
 *
 * Covers: default empty state, pre-seeded filter state, status-only,
 * type-only, date range, and all filters active.
 *
 * Because SearchFilterBar uses the `useSearchFilter` hook internally
 * (which manages its own state), the stories wrap the component in a
 * simple decorator rather than trying to pass controlled state through args.
 */
import type { Meta, StoryObj } from '@storybook/react';
import SearchFilterBar from './SearchFilterBar';

const meta: Meta<typeof SearchFilterBar> = {
  title: 'Components/SearchFilterBar',
  component: SearchFilterBar,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Reusable debounced search input paired with multi-select status/type ' +
          'filter buttons, a date range picker, and active-filter chips. ' +
          'All state is managed internally by the `useSearchFilter` hook.',
      },
    },
  },
  argTypes: {
    searchPlaceholder: {
      control: 'text',
      description: 'Placeholder text for the search input.',
    },
    statusOptions: {
      control: 'object',
      description: 'Array of status option strings to display as toggle buttons.',
    },
    typeOptions: {
      control: 'object',
      description: 'Array of type option strings to display as toggle buttons.',
    },
  },
};

export default meta;
type Story = StoryObj<typeof SearchFilterBar>;

// ── Status options used across stories ───────────────────────────────────────

const LOAN_STATUSES = ['active', 'repaid', 'liquidated', 'at_risk'];
const COLLATERAL_TYPES = ['Cattle', 'Goat', 'Sheep', 'Camel'];

// ── Stories ──────────────────────────────────────────────────────────────────

/** Default state — no filters active, search input is empty. */
export const Default: Story = {
  args: {
    statusOptions: LOAN_STATUSES,
    typeOptions: COLLATERAL_TYPES,
    searchPlaceholder: 'Search loans…',
  },
};

/** Loan status filters only — no type filters shown. */
export const StatusFilterOnly: Story = {
  args: {
    statusOptions: LOAN_STATUSES,
    typeOptions: [],
    searchPlaceholder: 'Search by borrower address…',
  },
  parameters: {
    docs: {
      description: {
        story: 'Renders only the status filter row when `typeOptions` is empty.',
      },
    },
  },
};

/** Collateral type filters only — no status filters shown. */
export const TypeFilterOnly: Story = {
  args: {
    statusOptions: [],
    typeOptions: COLLATERAL_TYPES,
    searchPlaceholder: 'Search collateral…',
  },
  parameters: {
    docs: {
      description: {
        story: 'Renders only the type filter row when `statusOptions` is empty.',
      },
    },
  },
};

/** No filter options — renders search input and date range picker only. */
export const SearchAndDateOnly: Story = {
  args: {
    statusOptions: [],
    typeOptions: [],
    searchPlaceholder: 'Search…',
  },
  parameters: {
    docs: {
      description: {
        story:
          'When both `statusOptions` and `typeOptions` are empty, only the search ' +
          'input and the date range picker are rendered.',
      },
    },
  },
};

/** Custom placeholder text for context-specific use. */
export const CustomPlaceholder: Story = {
  args: {
    statusOptions: LOAN_STATUSES,
    typeOptions: COLLATERAL_TYPES,
    searchPlaceholder: 'Search by borrower wallet address…',
  },
};

/** Full configuration — all options provided. */
export const FullConfiguration: Story = {
  args: {
    statusOptions: LOAN_STATUSES,
    typeOptions: COLLATERAL_TYPES,
    searchPlaceholder: 'Search loans or collateral…',
  },
  parameters: {
    docs: {
      description: {
        story:
          'All filter options active. Click status/type buttons to toggle ' +
          'filters and see the active-filter chips appear below.',
      },
    },
  },
};

/** Dark mode wrapper. */
export const DarkMode: Story = {
  args: {
    statusOptions: LOAN_STATUSES,
    typeOptions: COLLATERAL_TYPES,
    searchPlaceholder: 'Search loans…',
  },
  decorators: [
    (Story) => (
      <div className="dark bg-brown-900 p-6 rounded-2xl">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story:
          'Dark mode — Tailwind `dark` class applied via wrapper decorator.',
      },
    },
  },
};
