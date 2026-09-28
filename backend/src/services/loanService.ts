/**
 * Loan business logic — decoupled from HTTP layer for v1/v2 reuse.
 */
import {
  Address,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { z } from "zod";
import { stellarPublicKeySchema } from "../validators/stellar";
import {
  getCollateral,
  listLoans,
  listLoansCursor,
  getLoan,
  updateLoan,
  updateCollateral,
  insertTransaction,
  insertLiquidationEvent,
} from "../db/store";
import { fireWebhooks } from "../webhooks";
import { buildContractTx, CONTRACT_ID, NETWORK_PASSPHRASE } from "./contractTx";
import rpcClient from "../utils/rpcClient";
import { loanCreatedTotal, loanRepaidTotal, loanLiquidatedTotal } from "../metrics";

const SCALE = 10_000;
const SIMULATION_ACCOUNT = "GASPH4OCYOERATXIKLPNURXUP7ISAQU2KWFB5XLUJ3LQHKHOCN3CEGD6";

/**
 * Zod schema that validates a loan request payload.
 * Ensures `borrower` is a valid Stellar public key, `collateral_ids` is a
 * non-empty array of non-negative integers, `amount` is a positive integer,
 * and `min_disbursement` is an optional positive integer.
 */
export const loanRequestSchema = z.object({
  borrower: stellarPublicKeySchema,
  collateral_ids: z.array(z.number().int().nonnegative()).min(1),
  amount: z.number().int().positive(),
  min_disbursement: z.number().int().positive().optional(),
});

/**
 * Zod schema that validates a loan repayment payload.
 * Ensures `borrower` is a valid Stellar public key, `loan_id` is a
 * non-negative integer, and `amount` is a positive integer.
 */
export const loanRepaySchema = z.object({
  borrower: stellarPublicKeySchema,
  loan_id: z.number().int().nonnegative(),
  amount: z.number().int().positive(),
});

/**
 * Zod schema that validates a loan liquidation payload.
 * Ensures `liquidator` is a valid Stellar public key, `loan_id` is a
 * non-negative integer, and `repay_amount` is a positive integer.
 */
export const loanLiquidateSchema = z.object({
  liquidator: stellarPublicKeySchema,
  loan_id: z.number().int().nonnegative(),
  repay_amount: z.number().int().positive(),
});

/** Inferred TypeScript type for a validated loan request payload. */
export type LoanRequestInput = z.infer<typeof loanRequestSchema>;

/** Inferred TypeScript type for a validated loan repayment payload. */
export type LoanRepayInput = z.infer<typeof loanRepaySchema>;

/** Inferred TypeScript type for a validated loan liquidation payload. */
export type LoanLiquidateInput = z.infer<typeof loanLiquidateSchema>;

/**
 * Query parameters accepted by the paginated loan list endpoint.
 * All fields are optional strings because they originate from URL query params.
 */
export interface ListLoansQuery {
  /** 1-based page number (default: 1). */
  page?: string;
  /** Alias for `limit` used by newer API clients (takes precedence). */
  pageSize?: string;
  /** Maximum number of records per page (max: 100, default: 20). */
  limit?: string;
  /** Filter by loan status: `"active"` | `"repaid"` | `"liquidated"`. */
  status?: string;
  /** Filter to loans belonging to this Stellar address. */
  borrowerAddress?: string;
  /** ISO 8601 start date for `created_at` range filter. */
  from?: string;
  /** ISO 8601 end date for `created_at` range filter. */
  to?: string;
  /**
   * Opaque cursor token returned in a previous response.
   * When provided, cursor-based pagination is used instead of offset-based.
   * The cursor encodes `createdAt` + `id` of the last record seen.
   */
  cursor?: string;
}

/**
 * Shape of the object returned by {@link listLoansPaginated}.
 */
export interface ListLoansResult {
  /** Slice of loan records for the requested page. */
  data: ReturnType<typeof listLoans>["data"];
  /** Total number of loans matching the applied filters. */
  total: number;
  /** Current 1-based page number. */
  page: number;
  /** Effective page size used for this request. */
  limit: number;
  /** Alias for `limit` provided for API-v2 compatibility. */
  pageSize: number;
  /**
   * Opaque cursor token for the **next** page of results.
   * Present only when cursor-based pagination was used (`?cursor=…`).
   * Pass this value as `?cursor=<nextCursor>` on the subsequent request.
   * `null` means there are no further records.
   */
  nextCursor?: string | null;
  /**
   * Whether more records exist after the current page.
   * Present only when cursor-based pagination was used.
   */
  hasMore?: boolean;
  /**
   * Pagination mode used for this response.
   * `"cursor"` when `?cursor=` was supplied, `"offset"` otherwise.
   */
  paginationMode?: 'cursor' | 'offset';
}

/**
 * Thrown when a requested loan ID does not exist in the local database.
 */
export class LoanNotFoundError extends Error {
  /**
   * @param loanId - The ID that was looked up.
   */
  constructor(loanId: number | string) {
    super(`Loan ${loanId} not found`);
    this.name = "LoanNotFoundError";
  }
}

/**
 * Thrown when a liquidation is attempted but the loan's health factor
 * is at or above the liquidation threshold (i.e., the loan is healthy).
 */
export class LoanNotLiquidatableError extends Error {
  /** The computed health factor at the time of the failed liquidation attempt. */
  healthFactor: number | null;

  /**
   * @param healthFactor - Computed health factor (scaled by 10 000), or `null`
   *   when the value cannot be determined.
   */
  constructor(healthFactor: number | null) {
    super("Loan health factor is above liquidation threshold");
    this.name = "LoanNotLiquidatableError";
    this.healthFactor = healthFactor;
  }
}

/**
 * Thrown when pagination or filter query parameters are malformed or out of
 * the accepted range.
 */
export class InvalidPaginationError extends Error {
  /**
   * @param message - Optional human-readable description of the validation
   *   failure (defaults to a generic message).
   */
  constructor(message = "Invalid pagination parameters") {
    super(message);
    this.name = "InvalidPaginationError";
  }
}

/**
 * Builds a `request_loan` contract transaction and fires approval webhooks.
 * Increments the loan_created_total metric.
 *
 * @param input - Validated loan request payload (see {@link loanRequestSchema}).
 * @returns Unsigned XDR transaction envelope for client-side signing.
 * @throws If the RPC simulation or transaction preparation fails.
 */
export async function requestLoan(input: LoanRequestInput): Promise<{ xdr: string }> {
  const { borrower, collateral_ids, amount, min_disbursement } = input;
  
  // Get collateral info for metric labels
  const collateral = collateral_ids.length > 0 ? getCollateral(String(collateral_ids[0])) : null;
  const collateralType = collateral?.animal_type ?? "unknown";
  
  const idsScVal = xdr.ScVal.scvVec(
    collateral_ids.map((id) => nativeToScVal(BigInt(id), { type: "u64" }))
  );
  const minDisbursementScVal =
    min_disbursement !== undefined
      ? nativeToScVal(BigInt(min_disbursement), { type: "i128" })
      : xdr.ScVal.scvVoid();
  const xdrTx = await buildContractTx(borrower, "request_loan", [
    new Address(borrower).toScVal(),
    idsScVal,
    nativeToScVal(BigInt(amount), { type: "i128" }),
    minDisbursementScVal,
  ]);
  
  // Increment metric
  loanCreatedTotal.inc({ collateral_type: collateralType, status: "active" });
  
  fireWebhooks("loan.approved", { borrower, collateral_ids, amount });
  return { xdr: xdrTx };
}

/**
 * Builds a `repay_loan` contract transaction and fires repayment webhooks.
 * Increments the loan_repaid_total metric with the repayment amount.
 *
 * @param input - Validated loan repayment payload (see {@link loanRepaySchema}).
 * @returns Unsigned XDR transaction envelope for client-side signing.
 * @throws If the RPC simulation or transaction preparation fails.
 */
export async function repayLoan(input: LoanRepayInput): Promise<{ xdr: string }> {
  const { borrower, loan_id, amount } = input;
  
  // Get loan and collateral info for metric labels
  const loan = getLoan(String(loan_id));
  const collateral = loan ? getCollateral(loan.collateral_id) : null;
  const collateralType = collateral?.animal_type ?? "unknown";
  const status = loan?.status ?? "unknown";
  
  const xdrTx = await buildContractTx(borrower, "repay_loan", [
    new Address(borrower).toScVal(),
    nativeToScVal(BigInt(loan_id), { type: "u64" }),
    nativeToScVal(BigInt(amount), { type: "i128" }),
  ]);
  
  // Increment metric with repayment amount
  loanRepaidTotal.inc({ collateral_type: collateralType, status }, amount);
  
  fireWebhooks("loan.repaid", { borrower, loan_id, amount });
  return { xdr: xdrTx };
}

/**
 * Validates liquidation eligibility, builds the on-chain `liquidate` transaction,
 * updates local state, and fires liquidation webhooks.
 * Increments the loan_liquidated_total metric.
 *
 * Health factor is computed off-chain as:
 * `(collateral_value × 8000) / (loan_amount × SCALE)`.
 * A value below `SCALE` (10 000) is considered under-collateralised and eligible
 * for liquidation.
 *
 * @param input - Validated liquidation payload (see {@link loanLiquidateSchema}).
 * @returns Unsigned XDR and the updated loan record with status `"liquidated"`.
 * @throws {@link LoanNotFoundError} When the loan ID does not exist in the database.
 * @throws {@link LoanNotLiquidatableError} When the health factor is at or above
 *   the liquidation threshold.
 * @throws If the RPC simulation or transaction preparation fails.
 */
export async function liquidateLoan(input: LoanLiquidateInput) {
  const { liquidator, loan_id, repay_amount } = input;

  const loan = getLoan(String(loan_id));
  if (!loan) {
    throw new LoanNotFoundError(loan_id);
  }

  const collateral = getCollateral(loan.collateral_id);
  const collateralValue = collateral?.appraised_value ?? 0;
  const hf =
    loan.amount > 0 && collateralValue > 0
      ? ((collateralValue * 8_000) / (loan.amount * SCALE)) * SCALE
      : null;

  if (hf === null || hf >= SCALE) {
    throw new LoanNotLiquidatableError(hf);
  }

  const xdrTx = await buildContractTx(liquidator, "liquidate", [
    new Address(liquidator).toScVal(),
    nativeToScVal(BigInt(loan_id), { type: "u64" }),
    nativeToScVal(BigInt(repay_amount), { type: "i128" }),
  ]);

  const updatedLoan = updateLoan(loan.id, { status: "liquidated" });
  if (collateral) {
    updateCollateral(collateral.id, { status: "liquidated" });
  }

  insertLiquidationEvent({ loan_id: loan.id, liquidator, repay_amount });
  insertTransaction({
    borrower: loan.borrower,
    type: "liquidation",
    status: "completed",
    amount: repay_amount,
    loanId: loan.id,
    collateralId: loan.collateral_id,
  });

  // Increment metric
  const collateralType = collateral?.animal_type ?? "unknown";
  loanLiquidatedTotal.inc({ collateral_type: collateralType, status: "liquidated" });

  fireWebhooks("loan.liquidated", { liquidator, loan_id, repay_amount });
  return { xdr: xdrTx, loan: updatedLoan };
}

/**
 * Simulates the `get_loan` Soroban entry-point and returns its raw result.
 *
 * Uses a well-known Stellar account (`GASPH4OCYOERATXIKLPNURXUP7ISAQU2KWFB5XLUJ3LQHKHOCN3CEGD6`)
 * solely for simulation — the account does not need to sign.
 *
 * @param loanId - On-chain loan identifier (u64 encoded as a string).
 * @returns The raw `retval` from the contract simulation, or `undefined` when
 *   the simulation produces no return value.
 * @throws If the RPC call fails or the contract is not deployed.
 */
export async function getLoanOnChain(loanId: string) {
  const contract = new Contract(CONTRACT_ID);
  const account = (await rpcClient.getAccount(SIMULATION_ACCOUNT)) as any;
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call("get_loan", nativeToScVal(BigInt(loanId), { type: "u64" }))
    )
    .setTimeout(30)
    .build();
  const result = await rpcClient.simulateTransaction(tx);
  return { result: (result as { result?: { retval: unknown } }).result?.retval };
}

/**
 * Simulates the `health_factor` Soroban entry-point and returns the result.
 *
 * Uses a well-known Stellar account solely for simulation — the account does
 * not need to sign.
 *
 * @param loanId - On-chain loan identifier (u64 encoded as a string).
 * @returns The raw health factor `retval` from the contract simulation, or
 *   `undefined` when the simulation produces no return value.
 * @throws If the RPC call fails or the contract is not deployed.
 */
export async function getHealthFactor(loanId: string) {
  const contract = new Contract(CONTRACT_ID);
  const account = (await rpcClient.getAccount(SIMULATION_ACCOUNT)) as any;
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call("health_factor", nativeToScVal(BigInt(loanId), { type: "u64" }))
    )
    .setTimeout(30)
    .build();
  const result = await rpcClient.simulateTransaction(tx);
  return { health_factor: (result as { result?: { retval: unknown } }).result?.retval };
}

/**
 * Lists loans with pagination (offset-based or cursor-based) and optional
 * status / date / borrower filters.
 *
 * **Cursor mode** — When `query.cursor` is provided the function delegates to
 * {@link listLoansCursor} for efficient, stable traversal using
 * `(createdAt, id)` as the composite cursor key.  The response includes
 * `nextCursor` (the token for the next page, or `null`) and `hasMore`.
 *
 * **Offset mode** — When no `cursor` is provided, the legacy offset/page
 * mechanism is used for backward compatibility. Both `pageSize` (new) and
 * `limit` (legacy) are accepted.
 *
 * @param query - Query string parameters forwarded from the HTTP request.
 * @returns A paginated result object containing the loan data and metadata.
 * @throws {@link InvalidPaginationError} When pagination parameters are
 *   non-integer or out of range, status is not an accepted value, or
 *   `from`/`to` are not parseable ISO 8601 dates.
 */
export function listLoansPaginated(query: ListLoansQuery): ListLoansResult {
  // ── Resolve limit ──────────────────────────────────────────────────────────
  let limitRaw = 20;
  let isPageSize = false;

  if (query.pageSize !== undefined) {
    limitRaw = Number(query.pageSize);
    isPageSize = true;
  } else if (query.limit !== undefined) {
    limitRaw = Number(query.limit);
  }

  if (!Number.isInteger(limitRaw) || limitRaw < 1) {
    throw new InvalidPaginationError();
  }

  if (limitRaw > 100) {
    throw new InvalidPaginationError("pageSize must be between 1 and 100");
  }

  const maxLimit = Math.min(limitRaw, 100);
  const { status, borrowerAddress, from, to, cursor } = query;

  // ── Shared filter validation ───────────────────────────────────────────────
  const validStatuses = ["active", "repaid", "liquidated"];
  if (status && !validStatuses.includes(status)) {
    throw new InvalidPaginationError(`status must be one of: ${validStatuses.join(", ")}`);
  }
  if (from && isNaN(new Date(from).getTime())) {
    throw new InvalidPaginationError("from must be a valid ISO date");
  }
  if (to && isNaN(new Date(to).getTime())) {
    throw new InvalidPaginationError("to must be a valid ISO date");
  }

  // ── Cursor mode ────────────────────────────────────────────────────────────
  if (cursor !== undefined) {
    const cursorResult = listLoansCursor({
      cursor,
      limit: maxLimit,
      status,
      borrowerAddress,
      from,
      to,
    });

    return {
      data: cursorResult.data,
      total: -1,       // total is not computed in cursor mode (undefined cost)
      page: -1,        // not applicable in cursor mode
      limit: maxLimit,
      pageSize: maxLimit,
      nextCursor: cursorResult.nextCursor,
      hasMore: cursorResult.hasMore,
      paginationMode: 'cursor',
    };
  }

  // ── Offset mode (backward compat) ─────────────────────────────────────────
  const pageRaw = query.page !== undefined ? Number(query.page) : 1;

  if (!Number.isInteger(pageRaw) || pageRaw < 1) {
    throw new InvalidPaginationError();
  }

  const result = listLoans({ status, borrowerAddress, from, to, page: pageRaw, limit: maxLimit });
  return {
    data: result.data,
    total: result.total,
    page: result.page,
    limit: result.limit,
    pageSize: result.limit,
    nextCursor: null,
    hasMore: false,
    paginationMode: 'offset',
  };
}
