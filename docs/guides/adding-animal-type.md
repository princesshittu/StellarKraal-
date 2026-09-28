# Adding a New Supported Animal Type

StellarKraal currently supports `cattle`, `goat`, and `sheep` as collateral animal types.
This guide walks through every layer that needs a change when you add a new type — database,
smart contract, backend, frontend, and tests — so you can ship the feature safely and completely.

The guide uses `pig` as the example new type throughout. Substitute your actual type name everywhere.

---

## Overview

| Layer | Change required | File(s) |
|-------|-----------------|---------|
| DB migration | Add `pig` to allow-list index (optional) or confirm schema is flexible | `backend/src/db/migrations/` |
| Backend validator | Add to enum if you want strict server-side enforcement | `backend/src/validators/collateral.ts` |
| Backend appraisal | Add per-type pricing coefficient | `backend/src/utils/appraisalCache.ts` |
| Smart contract | Verify opaque `Symbol` — no change needed for basic support | `contracts/stellarkraal/src/lib.rs` |
| Frontend type | Add to `AnimalType` union | `frontend/src/context/LoanWizardContext.tsx` |
| Frontend wizard | Add entry to `ANIMAL_TYPES` constant | `frontend/src/components/wizard/steps/StepCollateral.tsx` |
| Frontend form | Add `<option>` to legacy form (if still in use) | `frontend/src/components/LoanForm.tsx` |
| Frontend FAQ | Update collateral type list | `frontend/src/lib/faqData.ts` |
| Docs | Mention new type in register-collateral guide | `docs/guides/register-collateral.md` |
| Tests | Add unit + integration tests for each layer | see §7 |

---

## Step 1 — Database Migration

The `collaterals` table stores `animal_type` as a free-form `TEXT` column. The schema does not
enforce an allow-list at the database level, so a new type works without a DDL change.

If you want to add a **database-level constraint** (recommended for production), create a new
numbered migration file:

```bash
# Create the migration file
touch backend/src/db/migrations/003_add_pig_animal_type_check.sql
```

```sql
-- Migration 003: Add CHECK constraint to restrict animal_type values.
-- Extend the IN list whenever a new type is added.
-- SQLite 3.25+ supports ALTER TABLE ... ADD CONSTRAINT only via a table rebuild.
-- Use a trigger instead for compatibility.

CREATE TRIGGER IF NOT EXISTS chk_collateral_animal_type
BEFORE INSERT ON collaterals
BEGIN
  SELECT RAISE(ABORT, 'Invalid animal_type')
  WHERE NEW.animal_type NOT IN ('cattle', 'goat', 'sheep', 'pig');
END;

CREATE TRIGGER IF NOT EXISTS chk_collateral_animal_type_upd
BEFORE UPDATE OF animal_type ON collaterals
BEGIN
  SELECT RAISE(ABORT, 'Invalid animal_type')
  WHERE NEW.animal_type NOT IN ('cattle', 'goat', 'sheep', 'pig');
END;
```

Run the migration:

```bash
cd backend
npm run migrate
# or directly:
npx ts-node src/cli/migrate.ts
```

> **Note:** If you are using PostgreSQL in staging/production, use a `CHECK` constraint instead:
> ```sql
> ALTER TABLE collaterals
>   DROP CONSTRAINT IF EXISTS chk_animal_type,
>   ADD CONSTRAINT chk_animal_type
>     CHECK (animal_type IN ('cattle', 'goat', 'sheep', 'pig'));
> ```

---

## Step 2 — Backend Validator (Allow-list)

`backend/src/validators/collateral.ts` currently validates `animal_type` as a non-empty string.
To enforce an explicit allow-list at the API layer, change `animalTypeSchema`:

```typescript
// backend/src/validators/collateral.ts
// Before (accepts any non-empty string):
export const animalTypeSchema = z.string().min(1);

// After (explicit allow-list):
export const animalTypeSchema = z.enum(['cattle', 'goat', 'sheep', 'pig'], {
  errorMap: () => ({
    message: "animal_type must be one of: cattle, goat, sheep, pig",
  }),
});
```

Update the validator test to cover the new type:

```typescript
// backend/src/validators/collateral.test.ts
it('accepts pig as a valid animal_type', () => {
  expect(() => animalTypeSchema.parse('pig')).not.toThrow();
});

it('rejects unknown animal types', () => {
  expect(() => animalTypeSchema.parse('dragon')).toThrow();
});
```

---

## Step 3 — Backend Appraisal Model

`backend/src/utils/appraisalCache.ts` caches oracle appraisal values keyed by `collateral_id`.
The appraisal pipeline feeds values into this cache after an oracle price update.

If your appraisal pipeline uses per-type pricing coefficients (e.g. a base price per animal
adjusted by type), add the new coefficient wherever that logic lives. Look for any
per-type `switch`/`if` blocks in `backend/src/services/collateralService.ts` or
`backend/src/utils/appraisalCache.ts`.

A typical coefficient map looks like:

```typescript
// backend/src/utils/appraisalCache.ts  (or collateralService.ts)
const ANIMAL_BASE_PRICE_USD: Record<string, number> = {
  cattle: 800,
  goat:   120,
  sheep:  150,
  pig:    200,  // ← add new type with an initial estimated base price
};

/**
 * Returns the estimated base price for one animal of the given type.
 * Used as a fallback when no oracle submission is available.
 */
export function getBasePrice(animalType: string): number {
  return ANIMAL_BASE_PRICE_USD[animalType] ?? 100; // default fallback
}
```

If the appraisal model uses a loan-to-value (LTV) ratio that varies by animal type, update the
LTV table too:

```typescript
const ANIMAL_LTV_BPS: Record<string, number> = {
  cattle: 7000, // 70%
  goat:   6000, // 60%
  sheep:  6500, // 65%
  pig:    5500, // 55% — lower LTV for less liquid asset
};
```

> **Important:** ADR-005 establishes that the off-chain appraisal model is a *convenience cache*
> for UX pre-checks only. All fund-gating decisions are enforced on-chain. The authoritative LTV
> and price limits are set in the smart contract. See [ADR-005](../adr/ADR-005-collateral-appraisal-model.md).

---

## Step 4 — Smart Contract

The Soroban contract (`contracts/stellarkraal/src/lib.rs`) stores `animal_type` as an opaque
`Symbol`. It does not enforce a fixed allow-list on-chain, so **no contract change is required**
to support a new animal type at the basic level.

```rust
// contracts/stellarkraal/src/lib.rs
// CollateralRecord stores animal_type as Symbol — any value is accepted.
pub struct CollateralRecord {
    pub owner: Address,
    pub animal_type: Symbol,  // opaque — no enum validation on-chain
    pub count: u32,
    pub appraised_value: i128,
    pub loan_id: u64,
}
```

**When you do need a contract change:**

- If you add per-type LTV limits or liquidation thresholds enforced on-chain, add a new `match`
  arm in the collateral validation function in `lib.rs` and extend the test fixtures in
  `contracts/stellarkraal/src/tests.rs`.
- After any contract change, rebuild and redeploy:

```bash
cd contracts/stellarkraal
cargo build --target wasm32-unknown-unknown --release
cargo test
# Deploy to testnet:
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellarkraal.wasm \
  --source <YOUR_KEY_ALIAS> \
  --network testnet
```

---

## Step 5 — Frontend

### 5a. Add to the `AnimalType` union

```typescript
// frontend/src/context/LoanWizardContext.tsx
// Before:
export type AnimalType = 'cattle' | 'goat' | 'sheep';

// After:
export type AnimalType = 'cattle' | 'goat' | 'sheep' | 'pig';
```

### 5b. Add an entry to the `ANIMAL_TYPES` constant in the wizard step

```typescript
// frontend/src/components/wizard/steps/StepCollateral.tsx
const ANIMAL_TYPES: { value: AnimalType; label: string; emoji: string }[] = [
  { value: 'cattle', label: 'Cattle',  emoji: '🐄' },
  { value: 'goat',   label: 'Goat',    emoji: '🐐' },
  { value: 'sheep',  label: 'Sheep',   emoji: '🐑' },
  { value: 'pig',    label: 'Pig',     emoji: '🐷' },  // ← new entry
];
```

Choose an emoji that renders on all major platforms. Stick to the Unicode 13.0 baseline for
broad browser and mobile support.

### 5c. Add an `<option>` to the legacy form (if still in use)

```tsx
// frontend/src/components/LoanForm.tsx
<select name="animal_type">
  <option value="cattle">Cattle 🐄</option>
  <option value="goat">Goat 🐐</option>
  <option value="sheep">Sheep 🐑</option>
  <option value="pig">Pig 🐷</option>  {/* ← new option */}
</select>
```

### 5d. Icon / image asset (optional)

If your UI displays a per-type illustration in addition to the emoji, add the SVG or PNG to
`frontend/public/icons/animals/` and reference it in the component:

```typescript
const ANIMAL_ICONS: Record<AnimalType, string> = {
  cattle: '/icons/animals/cattle.svg',
  goat:   '/icons/animals/goat.svg',
  sheep:  '/icons/animals/sheep.svg',
  pig:    '/icons/animals/pig.svg',   // ← add pig.svg to public/icons/animals/
};
```

Design guidelines:
- Target 48×48 px viewBox, monochrome or two-tone to match the existing token set.
- Follow the existing design tokens for colors so the icon renders correctly in both light and
  dark mode and meets WCAG AA contrast ratio (4.5:1 minimum).
- Run `npx svgo pig.svg` to optimize the SVG before committing.

---

## Step 6 — Content Updates

### FAQ data

```typescript
// frontend/src/lib/faqData.ts
{
  question: "What animals can I register as collateral?",
  answer:
    "StellarKraal currently supports cattle, goats, sheep, and pigs as collateral. " +
    "Each type has its own appraisal model and loan-to-value ratio.",
}
```

### Register-collateral guide

Open `docs/guides/register-collateral.md` and add `pigs` to any bullet list or table that
enumerates supported animal types.

---

## Step 7 — Tests

Run all relevant test suites after your changes to confirm nothing is broken.

### Backend unit tests

```bash
cd backend
npm test -- --testPathPattern="validators|appraisal"
```

Add a validator test for the new type (see Step 2 above) and a collateral service test:

```typescript
// backend/src/services/collateralService.test.ts (or index.test.ts)
it('registers a pig collateral successfully', async () => {
  const res = await request(app)
    .post('/api/v1/collateral/register')
    .set('Authorization', `Bearer ${token}`)
    .send({
      owner: TEST_PUBLIC_KEY,
      animal_type: 'pig',
      count: 3,
      appraised_value: 600_000,
    });
  expect(res.status).toBe(200);
  expect(res.body.collateral_id).toBeDefined();
});
```

### Frontend tests

```bash
cd frontend
npm test -- --testPathPattern="ui-components|StepCollateral"
```

Add a React Testing Library test asserting the new option renders and is selectable:

```typescript
// frontend/src/__tests__/ui-components.test.tsx
it('renders pig as a selectable animal type', async () => {
  render(<StepCollateral />);
  const pigOption = screen.getByRole('option', { name: /pig/i });
  expect(pigOption).toBeInTheDocument();
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: /animal type/i }),
    pigOption,
  );
  expect(pigOption).toHaveValue('pig');
});
```

### Contract tests

```bash
cd contracts/stellarkraal
cargo test
```

If you made contract changes, add test cases in `contracts/stellarkraal/src/tests.rs` covering
`pig` collateral registration and loan origination.

### End-to-end smoke test

Walk through the full loan wizard in the browser on a fresh branch:

1. Connect Freighter wallet on Stellar testnet.
2. Navigate to **Register Collateral** → select **Pig 🐷** → enter count and value → submit.
3. Sign the XDR in Freighter and confirm on testnet.
4. Navigate to **Request Loan** → select the pig collateral → enter an amount within the LTV limit → submit.
5. Verify the loan appears in the dashboard with status `Active`.
6. Repay the loan and confirm status transitions to `Repaid`.

---

## Checklist

Before opening a PR:

- [ ] DB migration created (or confirmed not needed) and tested with `npm run migrate`
- [ ] Backend validator updated and tests pass
- [ ] Appraisal model coefficient added
- [ ] Frontend `AnimalType` union updated
- [ ] Wizard `ANIMAL_TYPES` array updated with emoji
- [ ] Legacy form `<option>` added (if applicable)
- [ ] Icon asset added (if applicable) — WCAG AA contrast verified
- [ ] FAQ answer updated
- [ ] `docs/guides/register-collateral.md` updated
- [ ] All backend tests pass: `cd backend && npm test`
- [ ] All frontend tests pass: `cd frontend && npm test`
- [ ] Contract tests pass: `cd contracts/stellarkraal && cargo test`
- [ ] Full wizard flow verified manually on testnet

---

## Related

- [ADR-005: Off-chain appraisal model](../adr/ADR-005-collateral-appraisal-model.md)
- [ADR-006: Multi-oracle median aggregation](../adr/ADR-006-oracle-design.md)
- [Collateral validator](../../backend/src/validators/collateral.ts)
- [Appraisal cache](../../backend/src/utils/appraisalCache.ts)
- [Loan State Machine](../protocol/loan-state-machine.md)
- [Smart Contract Interface](../contracts/stellarkraal-interface.md)
