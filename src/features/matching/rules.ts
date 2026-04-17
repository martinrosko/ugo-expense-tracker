import type { RwAccount, RwBudget, RwTag } from '../../types/resco'
import type { CsvRow } from '../csv/types'

// ─── Configurable rule sets ───────────────────────────────────────────────────
// Add entries as you identify recurring patterns in your bank exports.

export interface PartnerRule {
  /** Substrings to match against CsvRow.partnername (case-insensitive). */
  keywords: string[]
  /** rw_accountid of the matching payment-partner account. */
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
  if (la.includes(lb) || lb.includes(la)) return 1
  const tokensA = la.split(/\s+/)
  const tokensB = new Set(lb.split(/\s+/))
  const overlap = tokensA.filter((t) => tokensB.has(t)).length
  return overlap / Math.max(tokensA.length, tokensB.size)
}

export function findPartner(
  partnername: string,
  partners: RwAccount[],
): RwAccount | undefined {
  if (!partnername) return undefined
  // 1. Rule-based lookup
  for (const rule of partnerRules) {
    if (rule.keywords.some((kw) => partnername.toLowerCase().includes(kw.toLowerCase()))) {
      return partners.find((p) => p.rw_accountid === rule.partnerId)
    }
  }
  // 2. Fuzzy name match
  let best: RwAccount | undefined
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

export function findTagsForRow(row: CsvRow, tags: RwTag[]): RwTag[] {
  const text = `${row.partnername} ${row.reference}`.toLowerCase()
  const matched: RwTag[] = []
  for (const rule of tagRules) {
    if (rule.keywords.some((kw) => text.includes(kw.toLowerCase()))) {
      const tag = tags.find((t) => t.rw_tagid === rule.tagId)
      if (tag) matched.push(tag)
    }
  }
  return matched
}

export function suggestBudget(
  row: CsvRow,
  budgets: RwBudget[],
  partners: RwAccount[],
): RwBudget | undefined {
  // Heuristic: if a partner is matched, pick the budget whose default account
  // matches the partner, or fall back to the first active budget.
  const partner = findPartner(row.partnername, partners)
  if (partner) {
    const match = budgets.find(
      (b) => b._rw_defaultaccountid_value === partner.rw_accountid,
    )
    if (match) return match
  }
  return budgets[0]
}

