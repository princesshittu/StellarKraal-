import { act, renderHook } from '@testing-library/react';
import { useWizardPersist } from '@/hooks/useWizardPersist';

interface TestState {
  step: number;
  loanAmount: string;
  animalType: string;
}

const MOCK_STATE: TestState = { step: 2, loanAmount: '500', animalType: 'cattle' };
const MOCK_WALLET = 'GABC123XYZ';

// Provide a real sessionStorage mock in jsdom
function clearSession() {
  sessionStorage.clear();
}

beforeEach(() => {
  clearSession();
});

describe('useWizardPersist', () => {
  describe('persist', () => {
    it('writes state to sessionStorage', () => {
      const { result } = renderHook(() => useWizardPersist<TestState>());
      act(() => {
        result.current.persist(MOCK_STATE);
      });

      const raw = sessionStorage.getItem('loan_wizard_session_state');
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.data).toEqual(MOCK_STATE);
      expect(typeof parsed.savedAt).toBe('number');
    });

    it('includes walletAddress when provided', () => {
      const { result } = renderHook(() =>
        useWizardPersist<TestState>({ walletAddress: MOCK_WALLET })
      );
      act(() => {
        result.current.persist(MOCK_STATE);
      });

      const raw = sessionStorage.getItem('loan_wizard_session_state');
      const parsed = JSON.parse(raw!);
      expect(parsed.walletAddress).toBe(MOCK_WALLET);
    });

    it('uses a custom storageKey when provided', () => {
      const customKey = 'custom_wizard_key';
      const { result } = renderHook(() =>
        useWizardPersist<TestState>({ storageKey: customKey })
      );
      act(() => {
        result.current.persist(MOCK_STATE);
      });

      expect(sessionStorage.getItem(customKey)).not.toBeNull();
      expect(sessionStorage.getItem('loan_wizard_session_state')).toBeNull();
    });
  });

  describe('restore', () => {
    it('returns null when nothing is saved', () => {
      const { result } = renderHook(() => useWizardPersist<TestState>());
      const restored = result.current.restore();
      expect(restored).toBeNull();
    });

    it('returns previously persisted data', () => {
      const { result } = renderHook(() => useWizardPersist<TestState>());
      act(() => {
        result.current.persist(MOCK_STATE);
      });
      const restored = result.current.restore();
      expect(restored).toEqual(MOCK_STATE);
    });

    it('returns null when wallet does not match', () => {
      const { result } = renderHook(() =>
        useWizardPersist<TestState>({ walletAddress: MOCK_WALLET })
      );
      act(() => {
        result.current.persist(MOCK_STATE);
      });

      // Create a second hook instance with a different wallet
      const { result: result2 } = renderHook(() =>
        useWizardPersist<TestState>({ walletAddress: 'GDIFFERENT' })
      );
      const restored = result2.current.restore();
      expect(restored).toBeNull();
    });

    it('returns data when no wallet is set (unscoped)', () => {
      // Persist without wallet
      const { result } = renderHook(() => useWizardPersist<TestState>());
      act(() => {
        result.current.persist(MOCK_STATE);
      });

      // Restore without wallet
      const { result: result2 } = renderHook(() => useWizardPersist<TestState>());
      const restored = result2.current.restore();
      expect(restored).toEqual(MOCK_STATE);
    });

    it('returns null when sessionStorage contains invalid JSON', () => {
      sessionStorage.setItem('loan_wizard_session_state', 'NOT_JSON}}}');
      const { result } = renderHook(() => useWizardPersist<TestState>());
      const restored = result.current.restore();
      expect(restored).toBeNull();
    });
  });

  describe('clear', () => {
    it('removes the persisted state from sessionStorage', () => {
      const { result } = renderHook(() => useWizardPersist<TestState>());
      act(() => {
        result.current.persist(MOCK_STATE);
      });
      // Confirm it was written
      expect(sessionStorage.getItem('loan_wizard_session_state')).not.toBeNull();

      act(() => {
        result.current.clear();
      });
      expect(sessionStorage.getItem('loan_wizard_session_state')).toBeNull();
    });

    it('restore returns null after clear', () => {
      const { result } = renderHook(() => useWizardPersist<TestState>());
      act(() => {
        result.current.persist(MOCK_STATE);
      });
      act(() => {
        result.current.clear();
      });
      const restored = result.current.restore();
      expect(restored).toBeNull();
    });
  });

  describe('lifecycle', () => {
    it('persist → restore → clear → restore returns null', () => {
      const { result } = renderHook(() => useWizardPersist<TestState>());

      // persist
      act(() => {
        result.current.persist(MOCK_STATE);
      });

      // restore
      const restored = result.current.restore();
      expect(restored).toEqual(MOCK_STATE);

      // clear
      act(() => {
        result.current.clear();
      });

      // restore again — should be null
      const restoredAfterClear = result.current.restore();
      expect(restoredAfterClear).toBeNull();
    });

    it('persists updated state on re-render', () => {
      const { result } = renderHook(() => useWizardPersist<TestState>());

      act(() => {
        result.current.persist({ ...MOCK_STATE, step: 1 });
      });
      act(() => {
        result.current.persist({ ...MOCK_STATE, step: 3 });
      });

      const restored = result.current.restore();
      expect(restored?.step).toBe(3);
    });
  });
});
