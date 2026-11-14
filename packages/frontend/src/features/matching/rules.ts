import type { CsvRow } from '../csv/types'
import type { AccountRef, Tx } from '../planTransactions'
import type { TagRef, Target } from './types'

// ─── Configurable rule sets ───────────────────────────────────────────────────
// Add entries as you identify recurring patterns in your bank exports.

export interface PartnerRule {
  /** Substrings to match against CsvRow.partnername (case-insensitive). */
  keywords: string[]
  /** Id of the matching payment-partner account. */
  partnerId: string
}

export interface TagRule {
  keywords: string[]
  tagId: string
}

export const partnerRules: PartnerRule[] = [
  // Example: { keywords: ['netflix', 'NETFLIX INC'], partnerId: 'xxxxxxxx-...' },
]

export const tagRules: TagRule[] = [
  // Example: { keywords: ['lidl', 'kaufland', 'tesco'], tagId: 'xxxxxxxx-...' },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Simple similarity: 1 if b is a substring of a (or vice-versa), else token overlap. */
export function stringSimilarity(a: string, b: string): number {
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  if (!la || !lb) return 0
  if (la.includes(lb) || lb.includes(la)) return 1
  const tokensA = la.split(/\s+/)
  const tokensB = new Set(lb.split(/\s+/))
  const overlap = tokensA.filter((t) => tokensB.has(t)).length
  return overlap / Math.max(tokensA.length, tokensB.size)
}

export function findPartner(partnername: string, partners: AccountRef[]): AccountRef | undefined {
  if (!partnername) return undefined
  // 1. Rule-based lookup
  for (const rule of partnerRules) {
    if (rule.keywords.some((kw) => partnername.toLowerCase().includes(kw.toLowerCase()))) {
      return partners.find((p) => p.id === rule.partnerId)
    }
  }
  // 2. Fuzzy name match
  let best: AccountRef | undefined
  let bestScore = 0
  for (const p of partners) {
    const score = stringSimilarity(partnername, p.name)
    if (score > bestScore) {
      bestScore = score
      best = p
    }
  }
  return bestScore >= 0.5 ? best : undefined
}

export function findTagsForRow(row: CsvRow, tags: TagRef[]): TagRef[] {
  const text = `${row.partnername} ${row.reference}`.toLowerCase()
  const matched: TagRef[] = []
  for (const rule of tagRules) {
    if (rule.keywords.some((kw) => text.includes(kw.toLowerCase()))) {
      const tag = tags.find((t) => t.id === rule.tagId)
      if (tag) matched.push(tag)
    }
  }
  return matched
}

export const targetKey = (planId: string, budgetId: string | null) => `${planId}|${budgetId ?? ''}`

const DAY_MS = 86_400_000
const dayOf = (s: string) => Date.parse(s.slice(0, 10))

/** Days between the date and the plan's period; 0 when inside, Infinity when the plan has no dates. */
function targetDistance(t: Target, date: string): number {
  if (!t.startDate || !t.endDate) return Infinity
  const d = dayOf(date)
  const start = dayOf(t.startDate)
  const end = dayOf(t.endDate)
  if (d < start) return (start - d) / DAY_MS
  if (d > end) return (d - end) / DAY_MS
  return 0
}

/** Plans containing the date first (completed before active), then the nearest ones. */
export function rankTargets(targets: Target[], date: string): Target[] {
  return targets
    .map((t) => ({ t, dist: targetDistance(t, date) }))
    .sort((a, b) => {
      const aIn = a.dist === 0
      const bIn = b.dist === 0
      if (aIn !== bIn) return aIn ? -1 : 1
      if (aIn && a.t.completed !== b.t.completed) return a.t.completed ? -1 : 1
      return a.dist === b.dist ? 0 : a.dist - b.dist
    })
    .map((x) => x.t)
}

/**
 * Suggests where a new transaction should go: the budget (or general area) the same partner was last used in,
 * taken from the plan that contains the date. `history` must be ordered newest plan first.
 */
export function suggestTarget(
  partner: AccountRef | undefined,
  history: { tx: Tx; target: Target }[],
  targets: Target[],
  date: string,
): Target | undefined {
  if (!partner) return undefined
  const hit = history.find(({ tx }) => tx.from?.id === partner.id || tx.to?.id === partner.id)
  if (!hit) return undefined
  return rankTargets(targets, date).find((t) => targetDistance(t, date) === 0 && t.budgetName === hit.target.budgetName)
}
