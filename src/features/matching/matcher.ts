import type { BankTransaction } from '../csv/types'
import type { PaymentPartner, Budget, Tag } from '../../types/resco'
import {
  partnerRules,
  tagRules,
  findBudgetForDate,
  findPartnerForDescription,
  findTagsForDescription,
} from './rules'

export interface MatchedTransaction {
  source: BankTransaction
  suggestedPartner?: PaymentPartner
  suggestedBudget?: Budget
  suggestedTags: Tag[]
  // 0–1 confidence: 1 = exact rule match, 0.5 = name-fuzzy match, 0 = no match
  confidence: number
}

export function matchTransactions(
  transactions: BankTransaction[],
  partners: PaymentPartner[],
  budgets: Budget[],
  tags: Tag[],
): MatchedTransaction[] {
  return transactions.map((tx) => {
    const suggestedPartner = findPartnerForDescription(tx.description, partners, partnerRules)
    const suggestedBudget = findBudgetForDate(tx.date, budgets)
    const suggestedTags = findTagsForDescription(tx.description, tags, tagRules)

    // Simple confidence heuristic
    const partnerScore = suggestedPartner
      ? partnerRules.some((r) =>
          r.keywords.some((kw) => tx.description.toLowerCase().includes(kw.toLowerCase()))
        )
        ? 1
        : 0.5
      : 0
    const confidence = partnerScore

    return {
      source: tx,
      suggestedPartner,
      suggestedBudget,
      suggestedTags,
      confidence,
    }
  })
}
