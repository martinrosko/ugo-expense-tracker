import type { CsvRow } from '../csv/types'
import { direction, type AccountRef, type Tx } from '../planTransactions'
import type { Candidate, MatchResult, TagRef, Target } from './types'
import { findPartner, findTagsForRow, stringSimilarity, suggestTarget, targetDistance, targetKey } from './rules'

const MATCH_THRESHOLD = 0.4
// A bank row can only belong to a plan whose period it falls into, give or take a few days
const PLAN_TOLERANCE_DAYS = 10

// ─── Scoring ─────────────────────────────────────────────────────────────────

/** Returns null when the transaction cannot be the counterpart of the row (opposite direction, or another known partner). */
function scoreTxVsRow(row: CsvRow, tx: Tx, rowPartner: AccountRef | undefined): number | null {
  const dir = direction(tx.from, tx.to)
  const rowDir = row.amount < 0 ? -1 : 1
  if (dir !== 0 && dir !== rowDir) return null

  const partner = [tx.to, tx.from].find((a) => a?.type === 'PAYMENT_PARTNER')
  const similarity = partner ? stringSimilarity(`${row.partnername} ${row.reference}`, partner.name) : 0
  const partnerFits = similarity >= 0.5
  // The row clearly names another partner than the planned transaction has
  if (partner && rowPartner && rowPartner.id !== partner.id && !partnerFits) return null

  let score = 0

  // Amount match — weight 0.5; prices drift, so a near miss only counts in full when the partner fits
  const txAmount = (tx.executedOn ? tx.amount : tx.plannedAmount) ?? tx.plannedAmount ?? 0
  if (txAmount !== 0 && row.amount !== 0) {
    const ratio = Math.abs(Math.abs(row.amount) - Math.abs(txAmount)) / Math.abs(txAmount)
    if (ratio < 0.005) score += 0.5
    else if (ratio < 0.05) score += partnerFits ? 0.35 : 0.15
    else if (ratio < 0.15) score += partnerFits ? 0.1 : 0
  }

  // Date proximity — weight 0.3
  const txDate = tx.executedOn ?? tx.plannedDate
  if (txDate && row.executedon) {
    const daysDiff = Math.abs(txDate.getTime() - new Date(row.executedon).getTime()) / 86_400_000
    if (daysDiff <= 1) score += 0.3
    else if (daysDiff <= 5) score += 0.2
    else if (daysDiff <= 10) score += 0.1
  }

  // Partner name match — weight 0.2
  score += 0.2 * similarity

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
  duplicates: ReadonlySet<number> = new Set(),
  pastBooking: (row: CsvRow) => { partner?: AccountRef; target?: Target } | undefined = () => undefined,
): MatchResult[] {
  // Best pairs first, so every planned transaction is matched to at most one row
  const targetByKey = new Map(targets.map((t) => [t.key, t]))
  const rowPartners = csvRows.map((row) => findPartner(`${row.partnername} ${row.reference}`, partners))
  const pairs = csvRows.flatMap((row, rowIndex) =>
    duplicates.has(rowIndex) ? [] : candidates.flatMap((tx) => {
      const target = targetByKey.get(targetKey(tx.planId, tx.budgetId))
      const distance = target ? targetDistance(target, row.executedon) : 0
      if (Number.isFinite(distance) && distance > PLAN_TOLERANCE_DAYS) return []
      const score = scoreTxVsRow(row, tx, rowPartners[rowIndex])
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
    if (duplicates.has(rowIndex)) return { csvRow: row, rowIndex, tags: [], confidence: 0, isDuplicate: true }
    const match = bestFor.get(rowIndex)
    const past = pastBooking(row)
    const partner = past?.partner ?? findPartner(row.partnername, partners)
    return {
      csvRow: row,
      rowIndex,
      matched: match?.tx,
      target: match
        ? targets.find((t) => t.key === targetKey(match.tx.planId, match.tx.budgetId))
        : past?.target ?? suggestTarget(partner, history, targets, row.executedon),
      partner,
      tags: findTagsForRow(row, tags),
      confidence: match?.score ?? topScore.get(rowIndex) ?? 0,
      isDuplicate: false, // set by analyzeCsv
    }
  })
}
