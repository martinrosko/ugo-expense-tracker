import type { CsvRow } from '../csv/types'
import type { AccountRef, Tx } from '../planTransactions'

export type TagRef = { id: string; name: string }

/** A planned, not yet executed transaction of an active plan. */
export type Candidate = Tx & { planId: string; planLabel: string }

/** Where a new transaction can be created: a plan's general area or one of its budgets. */
export type Target = {
  key: string
  planId: string
  budgetId: string | null
  /** Null for the plan's general area */
  budgetName: string | null
  label: string
  completed: boolean
  startDate: string | null
  endDate: string | null
}

export interface MatchResult {
  csvRow: CsvRow
  rowIndex: number

  /** Best-scoring planned transaction; the row will execute it. */
  matched?: Candidate

  /** Where a new transaction is created when nothing matched. */
  target?: Target

  /** Best matching payment-partner account. */
  partner?: AccountRef

  tags: TagRef[]

  /** 0–1 composite score (amount 50 % + date 30 % + partner 20 %). */
  confidence: number

  /** True when a bank ticket with this ticketId already exists for the account. */
  isDuplicate: boolean
}
