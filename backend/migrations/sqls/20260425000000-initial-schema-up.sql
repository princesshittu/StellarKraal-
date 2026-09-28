-- Migration: 001-initial-schema (up)
-- Creates the initial StellarKraal schema: collaterals, loans, idempotency_keys

CREATE TABLE IF NOT EXISTS collaterals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner       TEXT    NOT NULL,
  animal_type TEXT    NOT NULL,
  breed       TEXT,
  age_years   REAL,
  weight_kg   REAL,
  photo_url   TEXT,
  count       INTEGER NOT NULL CHECK (count > 0),
  appraised_value INTEGER NOT NULL CHECK (appraised_value > 0),
  loan_id     INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS loans (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  borrower         TEXT    NOT NULL,
  collateral_id    INTEGER NOT NULL REFERENCES collaterals(id),
  collateral_value INTEGER NOT NULL,
  principal        INTEGER NOT NULL CHECK (principal > 0),
  outstanding      INTEGER NOT NULL CHECK (outstanding >= 0),
  status           TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'repaid', 'liquidated')),
  created_at       INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at       INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key         TEXT    PRIMARY KEY,
  status_code INTEGER NOT NULL,
  response    TEXT    NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_loans_borrower ON loans(borrower);
CREATE INDEX IF NOT EXISTS idx_collaterals_owner ON collaterals(owner);
