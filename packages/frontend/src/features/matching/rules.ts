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

/** Lowercase words only: no accents, no bank symbols ("/VS…/SS…"), "+" read as "plus". */
const nameWords = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\/\S*/g, ' ').replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, ' ').trim()

/** Simple similarity: 1 if b is a substring of a (or vice-versa), else token overlap. */
export function stringSimilarity(a: string, b: string): number {
  const la = nameWords(a)
  const lb = nameWords(b)
  if (!la || !lb) return 0
  // Very short names would be found inside almost any text
  if (Math.min(la.length, lb.length) >= 3 && (la.includes(lb) || lb.includes(la))) return 1
  const tokensA = la.split(' ')
  const tokensB = new Set(lb.split(' '))
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

export const TIER_LABELS = ['Exact match', 'Close match', 'Possible match', 'Other'] as const

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const localDay = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())

/**
 * Orders candidates by how well they fit the bank row. Tiers (0 = best):
 * 0 same amount and day, 1 amount within 5 % and ±2 days, 2 amount within 15 % and ±5 days, 3 the rest.
 * Inside a tier, candidates whose account is named in the bank row come first, then the nearest date.
 */
export function rankCandidates<T extends Tx>(row: CsvRow, candidates: T[], bankAccountId: string): { candidate: T; tier: number }[] {
  const text = norm([row.partnername, row.reference, row.partneraccountnumber].join(' '))
  const partnerName = norm(row.partnername)
  const rowAmount = Math.abs(row.amount)
  const rowDay = Date.parse(row.executedon.slice(0, 10))

  return candidates
    .map((candidate) => {
      const txAmount = Math.abs((candidate.executedOn ? candidate.amount : candidate.plannedAmount) ?? candidate.plannedAmount ?? 0)
      const amountDiff = txAmount === 0 ? Infinity : Math.abs(rowAmount - txAmount) / txAmount
      const date = candidate.executedOn ?? candidate.plannedDate
      const days = date && !isNaN(rowDay) ? Math.abs(localDay(date) - rowDay) / DAY_MS : Infinity

      const tier =
        Math.abs(rowAmount - txAmount) < 0.005 && days === 0 ? 0
        : amountDiff <= 0.05 && days <= 2 ? 1
        : amountDiff <= 0.15 && days <= 5 ? 2
        : 3
      const accountHint = [candidate.from, candidate.to].some((a) => {
        if (!a || a.id === bankAccountId) return false
        const name = norm(a.name)
        return name.length >= 3 && (text.includes(name) || (partnerName !== '' && stringSimilarity(partnerName, name) >= 0.5))
      })
      return { candidate, tier, accountHint, days }
    })
    .sort((a, b) => a.tier - b.tier || Number(b.accountHint) - Number(a.accountHint) || (a.days === b.days ? 0 : a.days - b.days))
    .map(({ candidate, tier }) => ({ candidate, tier }))
}

const DAY_MS = 86_400_000
const dayOf = (s: string) => Date.parse(s.slice(0, 10))

/** Days between the date and the plan's period; 0 when inside, Infinity when the plan has no dates. */
export function targetDistance(t: Target, date: string): number {
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

/** Where an earlier bank ticket of the same counterparty ended up. */
export type PastBooking = {
  partner: AccountRef | null
  budgetId: string | null
  budgetName: string | null
  budgetTemplateId: string | null
  planTemplateId: string | null
}

/**
 * The same budget as in the past booking, taken from the plan period containing the date:
 * matched by budget template, else by name. A general-area booking maps to the general area.
 */
export function targetFromPast(past: PastBooking, targets: Target[], date: string): Target | undefined {
  const inPeriod = rankTargets(targets, date).filter((t) => targetDistance(t, date) === 0)
  const samePlan = past.planTemplateId ? inPeriod.filter((t) => t.planTemplateId === past.planTemplateId) : []
  const pick = (pool: Target[]) =>
    pool.find((t) =>
      past.budgetId === null
        ? t.budgetId === null
        : t.budgetId !== null && (past.budgetTemplateId ? t.budgetTemplateId === past.budgetTemplateId : t.budgetName === past.budgetName),
    )
  return pick(samePlan) ?? pick(inPeriod)
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
