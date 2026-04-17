import type { PaymentPartner, Budget, Tag } from '../../types/resco'

export interface PartnerRule {
  keywords: string[]   // substrings to match in transaction description (case-insensitive)
  partnerId: string
}

export interface TagRule {
  keywords: string[]
  tagId: string
}

// ---- Partner rules ----
// Add a new entry for each known payment partner.
// Example: { keywords: ['netflix', 'NETFLIX'], partnerId: 'partner-uuid' }
export const partnerRules: PartnerRule[] = []

// ---- Tag rules ----
// Example: { keywords: ['supermarket', 'lidl', 'kaufland'], tagId: 'tag-uuid' }
export const tagRules: TagRule[] = []

// ---- Budget matching ----
// Matches a transaction date to a budget by its start/end date range.
export function findBudgetForDate(
  date: string,
  budgets: Budget[],
): Budget | undefined {
  return budgets.find((b) => date >= b.startDate && date <= b.endDate)
}

// ---- Partner matching ----
export function findPartnerForDescription(
  description: string,
  partners: PaymentPartner[],
  rules: PartnerRule[],
): PaymentPartner | undefined {
  const lower = description.toLowerCase()
  for (const rule of rules) {
    if (rule.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return partners.find((p) => p.id === rule.partnerId)
    }
  }
  // Fallback: fuzzy name match directly against partner names
  return partners.find((p) => lower.includes(p.name.toLowerCase()))
}

// ---- Tag matching ----
export function findTagsForDescription(
  description: string,
  tags: Tag[],
  rules: TagRule[],
): Tag[] {
  const lower = description.toLowerCase()
  const matched: Tag[] = []
  for (const rule of rules) {
    if (rule.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      const tag = tags.find((t) => t.id === rule.tagId)
      if (tag) matched.push(tag)
    }
  }
  return matched
}
