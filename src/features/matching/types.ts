import type { CsvRow } from '../csv/types'
import type { RwTransaction, RwBudget, RwPlan, RwAccount, RwTag } from '../../types/resco'

export interface MatchResult {
  csvRow: CsvRow
  rowIndex: number

  /**
   * Best-scoring existing planned transaction (no bankticket yet).
   * If set → we link the new bankticket to this transaction.
   */
  matchedTransaction?: RwTransaction

  /** Budget of the matched transaction (resolved for display). */
  matchedBudget?: RwBudget

  /** Plan of the matched transaction (resolved for display). */
  matchedPlan?: RwPlan

  /**
   * If no transaction matched confidently, suggest this budget
   * so the user can create a new transaction under it.
   */
  suggestedBudget?: RwBudget
  suggestedPlan?: RwPlan

  /** Best matching payment-partner account (from rw_partnername). */
  suggestedPartner?: RwAccount

  suggestedTags: RwTag[]

  /** 0–1 composite score (amount 50 % + date 30 % + partner 20 %). */
  confidence: number

  /** True when a bankticket with this ticketid already exists in Resco. */
  isDuplicate: boolean
}
