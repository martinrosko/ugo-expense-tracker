import type { CsvRow } from '../csv/types'
import type { RwTransaction, RwBudget, RwPlan, RwAccount, RwTag } from '../../types/resco'
import type { MatchResult } from './types'
import { findPartner, findTagsForRow, suggestBudget, stringSimilarity } from './rules'

const MATCH_THRESHOLD = 0.4

// ─── Scoring ─────────────────────────────────────────────────────────────────

function scoreTxVsRow(
  row: CsvRow,
  tx: RwTransaction,
  partners: RwAccount[],
): number {
  let score = 0

  // Amount match — weight 0.5
  const txAmount = tx.rw_amount ?? tx.rw_plannedamount ?? 0
  if (txAmount !== 0 && row.amount !== 0) {
    const ratio =
      Math.abs(Math.abs(row.amount) - Math.abs(txAmount)) / Math.abs(txAmount)
    if (ratio < 0.01) score += 0.5
    else if (ratio < 0.05) score += 0.3
    else if (ratio < 0.15) score += 0.1
  }

  // Date proximity — weight 0.3
  if (tx.rw_plannedon && row.executedon) {
    const daysDiff =
      Math.abs(
        new Date(tx.rw_plannedon).getTime() - new Date(row.executedon).getTime(),
      ) / 86_400_000
    if (daysDiff <= 1) score += 0.3
    else if (daysDiff <= 5) score += 0.2
    else if (daysDiff <= 10) score += 0.1
  }

  // Partner name match — weight 0.2
  if (row.partnername) {
    const toPartner = partners.find((p) => p.id === tx.__rw_toaccountid_id)
    const fromPartner = partners.find((p) => p.id === tx.__rw_fromaccountid_id)
    const partner = toPartner ?? fromPartner
    if (partner) {
      score += 0.2 * stringSimilarity(row.partnername, partner.name)
    }
  }

  return score
}

// ─── Main function ───────────────────────────────────────────────────────────

export function matchAll(
  csvRows: CsvRow[],
  transactions: RwTransaction[],
  budgets: RwBudget[],
  plans: RwPlan[],
  partners: RwAccount[],
  tags: RwTag[],
): MatchResult[] {
  // Only consider transactions that have no bankticket yet
  const unmatched = transactions.filter((tx) => !tx.__rw_bankticketid_id)

  return csvRows.map((row, rowIndex) => {
    // Score all unmatched transactions
    const scored = unmatched
      .map((tx) => ({ tx, score: scoreTxVsRow(row, tx, partners) }))
      .sort((a, b) => b.score - a.score)

    const best = scored[0]
    const isConfidentMatch = best && best.score >= MATCH_THRESHOLD

    let matchedTransaction: RwTransaction | undefined
    let matchedBudget: RwBudget | undefined
    let matchedPlan: RwPlan | undefined
    let suggestedBudget: RwBudget | undefined
    let suggestedPlan: RwPlan | undefined

    if (isConfidentMatch) {
      matchedTransaction = best.tx
      matchedBudget = budgets.find(
        (b) => b.id === best.tx.__rw_parentid_id,
      )
      if (matchedBudget) {
        matchedPlan = plans.find(
          (p) => p.id === matchedBudget!.__rw_parentid_id,
        )
      } else {
        // Parent might be a plan directly
        matchedPlan = plans.find(
          (p) => p.id === best.tx.__rw_parentid_id,
        )
      }
    } else {
      suggestedBudget = suggestBudget(row, budgets, partners)
      if (suggestedBudget) {
        suggestedPlan = plans.find(
          (p) => p.id === suggestedBudget!.__rw_parentid_id,
        )
      }
    }

    return {
      csvRow: row,
      rowIndex,
      matchedTransaction,
      matchedBudget,
      matchedPlan,
      suggestedBudget,
      suggestedPlan,
      suggestedPartner: findPartner(row.partnername, partners),
      suggestedTags: findTagsForRow(row, tags),
      confidence: best?.score ?? 0,
      isDuplicate: false, // set by UploadPage after API duplicate check
    }
  })
}

