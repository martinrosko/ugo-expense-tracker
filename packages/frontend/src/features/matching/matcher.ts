import type { CsvRow } from '../csv/types'
import { direction, type AccountRef, type Tx } from '../planTransactions'
import type { Candidate, MatchResult, TagRef, Target } from './types'
import { findPartner, findTagsForRow, stringSimilarity, suggestTarget, targetKey } from './rules'

const MATCH_THRESHOLD = 0.4

// ─── Scoring ─────────────────────────────────────────────────────────────────

/** Returns null when the transaction cannot be the counterpart of the row (opposite direction). */
function scoreTxVsRow(row: CsvRow, tx: Tx): number | null {
  const dir = direction(tx.from, tx.to)
  const rowDir = row.amount < 0 ? -1 : 1
  if (dir !== 0 && dir !== rowDir) return null

  let score = 0

  // Amount match — weight 0.5
  const txAmount = tx.plannedAmount ?? 0
  if (txAmount !== 0 && row.amount !== 0) {
    const ratio = Math.abs(Math.abs(row.amount) - Math.abs(txAmount)) / Math.abs(txAmount)
    if (ratio < 0.01) score += 0.5
    else if (ratio < 0.05) score += 0.3
    else if (ratio < 0.15) score += 0.1
  }

  // Date proximity — weight 0.3
  if (tx.plannedDate && row.executedon) {
    const daysDiff = Math.abs(tx.plannedDate.getTime() - new Date(row.executedon).getTime()) / 86_400_000
    if (daysDiff <= 1) score += 0.3
    else if (daysDiff <= 5) score += 0.2
    else if (daysDiff <= 10) score += 0.1
  }

  // Partner name match — weight 0.2
  if (row.partnername) {
    const partner = [tx.to, tx.from].find((a) => a?.type === 'PAYMENT_PARTNER')
    if (partner) score += 0.2 * stringSimilarity(row.partnername, partner.name)
  }

  return score
}

// ─── Main function ───────────────────────────────────────────────────────────

export function matchAll(
  csvRows: CsvRow[],
  candidates: Candidate[],
  partners: AccountRef[],
  tags: TagRef[],
  history: { tx: Tx; target: Target }[],
  targets: Target[],
): MatchResult[] {
  // Best pairs first, so every planned transaction is matched to at most one row
  const pairs = csvRows.flatMap((row, rowIndex) =>
    candidates.flatMap((tx) => {
      const score = scoreTxVsRow(row, tx)
      return score === null ? [] : [{ rowIndex, tx, score }]
    }),
  ).sort((a, b) => b.score - a.score)

  const bestFor = new Map<number, { tx: Candidate; score: number }>()
  const usedTx = new Set<string>()
  const topScore = new Map<number, number>()
  for (const p of pairs) {
    if (!topScore.has(p.rowIndex)) topScore.set(p.rowIndex, p.score)
    if (p.score < MATCH_THRESHOLD || bestFor.has(p.rowIndex) || usedTx.has(p.tx.id)) continue
    bestFor.set(p.rowIndex, { tx: p.tx, score: p.score })
    usedTx.add(p.tx.id)
  }

  return csvRows.map((row, rowIndex) => {
    const match = bestFor.get(rowIndex)
    const partner = findPartner(row.partnername, partners)
    return {
      csvRow: row,
      rowIndex,
      matched: match?.tx,
      target: match
        ? targets.find((t) => t.key === targetKey(match.tx.planId, match.tx.budgetId))
        : suggestTarget(partner, history, targets, row.executedon),
      partner,
      tags: findTagsForRow(row, tags),
      confidence: match?.score ?? topScore.get(rowIndex) ?? 0,
      isDuplicate: false, // set by UploadPage
    }
  })
}
