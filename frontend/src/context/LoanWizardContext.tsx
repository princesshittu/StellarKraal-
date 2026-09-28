'use client';
import { createContext, useContext, useState, ReactNode, useEffect, useRef } from 'react';
import { useFormAutoSave } from '@/hooks/useFormAutoSave';
import { useWizardPersist } from '@/hooks/useWizardPersist';

export type AnimalType = 'cattle' | 'goat' | 'sheep';

export interface CollateralItem {
  id: string; // local uuid before on-chain registration
  animalType: AnimalType;
  count: string;
  appraisedValue: string;
  collateralId: string; // returned after on-chain register
}

export interface SubmittedLoan {
  loanId: string;
  amount: number;
  termDays: string;
  totalRepay: number;
}

export interface WizardState {
  // Step 1 – Collateral (multi-item, ordered)
  collaterals: CollateralItem[];

  // Legacy single-item fields (kept for backward compat with StepAmount/Review/Confirm)
  animalType: AnimalType;
  count: string;
  appraisedValue: string;
  collateralId: string;

  // Step 2 – Amount
  loanAmount: string;
  loanTermDays: string;

  // Meta
  step: number;
  loading: boolean;
  error: string | null;
}

interface WizardCtx extends WizardState {
  setField: <K extends keyof WizardState>(key: K, value: WizardState[K]) => void;
  setCollaterals: (items: CollateralItem[]) => void;
  nextStep: () => void;
  prevStep: () => void;
  reset: () => void;
  canProceed: () => boolean;
  /**
   * Drops the persisted autosave without resetting in-memory state (#523).
   * Used right after a successful loan submission, where the just-submitted
   * values are still shown on screen but shouldn't be offered for restore.
   */
  clearSavedProgress: () => void;
}

export function makeItem(overrides?: Partial<CollateralItem>): CollateralItem {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    animalType: 'cattle',
    count: '',
    appraisedValue: '',
    collateralId: '',
    ...overrides,
  };
}

const defaults: WizardState = {
  collaterals: [],
  animalType: 'cattle',
  count: '',
  appraisedValue: '',
  collateralId: '',
  loanAmount: '',
  loanTermDays: '30',
  step: 1,
  loading: false,
  error: null,
};

function createInitialState(): WizardState {
  return { ...defaults, collaterals: [makeItem()] };
}

function hasDraftData(state: WizardState): boolean {
  return (
    state.collaterals.some(
      (item) =>
        item.count.trim().length > 0 ||
        item.appraisedValue.trim().length > 0 ||
        item.collateralId.trim().length > 0
    ) || state.loanAmount.trim().length > 0
  );
}

function withPrimaryItem(state: WizardState): WizardState {
  if (state.collaterals && state.collaterals.length > 0) return state;
  if (!state.count && !state.appraisedValue) {
    return { ...state, collaterals: [makeItem()] };
  }
  return {
    ...state,
    collaterals: [
      makeItem({
        animalType: state.animalType,
        count: state.count,
        appraisedValue: state.appraisedValue,
        collateralId: state.collateralId,
      }),
    ],
  };
}

const STORAGE_KEY = 'loan_wizard_state';
// Persisted wizard state older than this is treated as gone rather than
// restored (#523) — a form left mid-fill for a day is more likely stale
// than something the borrower still wants to resume.
const SAVE_EXPIRY_MS = 24 * 60 * 60 * 1000;

const LoanWizardContext = createContext<WizardCtx | null>(null);

export function LoanWizardProvider({
  children,
  walletAddress,
}: {
  children: ReactNode;
  walletAddress?: string;
}) {
  const [state, setState] = useState<WizardState>(createInitialState);
  const restoredRef = useRef(false);

  // Autosaves `state` to localStorage as the wizard is filled in, and gives
  // us restore/clear helpers (#523). Scoping by walletAddress, when known,
  // keeps one wallet from resuming another's in-progress loan request.
  const { restoreSavedData, clearSavedData } = useFormAutoSave<WizardState>({
    storageKey: STORAGE_KEY,
    data: state,
    enabled: hasDraftData(state),
    walletAddress,
    interval: 1000,
    expiryMs: SAVE_EXPIRY_MS,
  });

  // sessionStorage persistence — survives page reloads within the same tab
  // so mid-wizard refreshes don't lose entered data (#1201).
  const sessionPersist = useWizardPersist<WizardState>({ walletAddress });

  // Persist every state change to sessionStorage immediately
  useEffect(() => {
    if (hasDraftData(state)) {
      sessionPersist.persist(state);
    }
  }, [state, sessionPersist]);

  // Restore once on mount — prefer sessionStorage (survives refresh) over
  // localStorage (survives tab close) to pick up the most recent state.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    // Try sessionStorage first (handles refresh mid-wizard)
    const sessionRestored = sessionPersist.restore();
    if (sessionRestored) {
      setState(withPrimaryItem(sessionRestored));
      return;
    }

    // Fall back to localStorage (handles returning later in the same day)
    const restored = restoreSavedData();
    if (restored) {
      setState(withPrimaryItem(restored));
    }
    // Intentionally run once — restoreSavedData reads storage synchronously
    // and re-running it on every render would fight the autosave interval.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function setField<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function setCollaterals(items: CollateralItem[]) {
    setState((s) => {
      const primary = items[0];
      return {
        ...s,
        collaterals: items,
        ...(primary
          ? {
              animalType: primary.animalType,
              count: primary.count,
              appraisedValue: primary.appraisedValue,
            }
          : {}),
      };
    });
  }

  function canProceed(): boolean {
    if (state.step === 1) {
      return (
        !!state.count &&
        !!state.appraisedValue &&
        parseInt(state.count) > 0 &&
        parseInt(state.appraisedValue) > 0
      );
    }
    if (state.step === 2) {
      return !!state.loanAmount && parseInt(state.loanAmount) > 0;
    }
    return true;
  }

  function nextStep() {
    if (canProceed()) {
      setState((s) => ({ ...s, step: Math.min(s.step + 1, 4), error: null }));
    }
  }

  function prevStep() {
    setState((s) => ({ ...s, step: Math.max(s.step - 1, 1), error: null }));
  }

  function reset() {
    setState(createInitialState());
    clearSavedData();
    sessionPersist.clear();
  }

  return (
    <LoanWizardContext.Provider
      value={{
        ...state,
        setField,
        setCollaterals,
        nextStep,
        prevStep,
        reset,
        canProceed,
        clearSavedProgress: () => {
          clearSavedData();
          sessionPersist.clear();
        },
      }}
    >
      {children}
    </LoanWizardContext.Provider>
  );
}

export function useWizard() {
  const ctx = useContext(LoanWizardContext);
  if (!ctx) throw new Error('useWizard must be used inside LoanWizardProvider');
  return ctx;
}
