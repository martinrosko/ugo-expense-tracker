import apiClient from '../../api/apiClient'
import { planLabel } from '../planLabel'
import { resolveAll, type AccountRef, type RawPlan, type Tx } from '../planTransactions'
import type { CsvRow } from '../csv/types'
import { stripBankSymbols } from '../csv/parseCSV'
import { matchAll } from './matcher'
import { targetKey, targetFromPast, type PastBooking } from './rules'
import type { Candidate, MatchResult, TagRef, Target } from './types'

type BankTicketRow = {
  id: string
  ticketId: string | null
  executedOn: string
  partnerName: string | null
  partnerAccountNumber: string | null
  pairedTransactionId: string | null
  stateCode: number
  transaction: {
    fromAccount: AccountRef | null
    toAccount: AccountRef | null
    plan: { templateId: string | null } | null
    budget: { id: string; name: string | null; templateId: string | null; template: { name: string | null } | null; plan: { templateId: string | null } } | null
  } | null
}

const normName = (s: string | null | undefined) => stripBankSymbols(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

type PlanItem = {
  id: string
  name: string | null
  startDate: string | null
  endDate: string | null
  intervalType: string
  templateIntervalType?: string | null
  isTemplate: boolean
  statusCode: number
}

export type Analysis = {
  results: MatchResult[]
  candidates: Candidate[]
  /** Executed movements between own accounts that hold the other account's ticket */
  pairCandidates: Candidate[]
  targets: Target[]
  partners: AccountRef[]
  accounts: AccountRef[]
  tags: TagRef[]
  accountId: string
}

/** Loads the plans and matches the CSV rows against them; rows already imported for the bank account are flagged as duplicates. */
export async function analyzeCsv(csvRows: CsvRow[], accountId: string): Promise<Analysis> {
  // Completed plans are limited to the period covered by the CSV
  const dates = csvRows.map((r) => r.executedon).filter(Boolean).sort()
  const [active, completed, accountsRes, tagsRes, ticketsRes] = await Promise.all([
    apiClient.get<PlanItem[]>('/api/plans', { params: { status: '1', isTemplate: 'false' } }),
    apiClient.get<PlanItem[]>('/api/plans', { params: { status: '3', isTemplate: 'false', from: dates[0], to: dates[dates.length - 1] } }),
    apiClient.get<AccountRef[]>('/api/accounts'),
    apiClient.get<TagRef[]>('/api/tags'),
    apiClient.get<BankTicketRow[]>('/api/bank-tickets', { params: { accountId } }),
  ])

  // Newest plan first, which is the order the partner history is searched in
  const planItems = [...active.data, ...completed.data].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))
  const details = await Promise.all(planItems.map((p) => apiClient.get<RawPlan>(`/api/plans/${p.id}`)))
  const accountMap = new Map(accountsRes.data.map((a) => [a.id, a]))

  const candidates: Candidate[] = []
  const targets: Target[] = []
  const history: { tx: Tx; target: Target }[] = []
  const linked = new Map<string, { tx: Candidate; target: Target | undefined }>()
  const byTx = new Map<string, { tx: Candidate; target: Target | undefined }>()
  planItems.forEach((item, i) => {
    const plan = details[i].data
    const label = planLabel(item)
    const completedPlan = item.statusCode === 3
    const planTargets: Target[] = [
      {
        key: targetKey(plan.id, null), planId: plan.id, budgetId: null, budgetName: null, budgetTemplateId: null, planTemplateId: plan.templateId,
        label: `${label} › General`, completed: completedPlan, startDate: item.startDate, endDate: item.endDate,
      },
      ...plan.budgets.map((b) => {
        const budgetName = b.name ?? b.template?.name ?? '(unnamed)'
        return {
          key: targetKey(plan.id, b.id), planId: plan.id, budgetId: b.id, budgetName, budgetTemplateId: b.templateId ?? null, planTemplateId: plan.templateId,
          label: `${label} › ${budgetName}`, completed: completedPlan, startDate: item.startDate, endDate: item.endDate,
        }
      }),
    ]
    targets.push(...planTargets)
    const txs = resolveAll(plan, accountMap)
    for (const tx of txs) {
      const target = planTargets.find((t) => t.budgetId === tx.budgetId)
      if (target) history.push({ tx, target })
      byTx.set(tx.id, { tx: { ...tx, planId: plan.id, planLabel: label }, target })
      // Every executed or pending transaction that still has no bank ticket, including those of completed plans/budgets
      if (!tx.raw.bankTicketId) {
        candidates.push({ ...tx, planId: plan.id, planLabel: label })
      } else {
        linked.set(tx.raw.bankTicketId, { tx: { ...tx, planId: plan.id, planLabel: label }, target })
      }
    }
  })

  const partners = accountsRes.data.filter((a) => a.type === 'PAYMENT_PARTNER')
  // The bank's document number alone is not unique; the same number can come back on another date
  const ticketKey = (ticketId: string, date: string) => `${ticketId}|${date.slice(0, 10)}`
  // A ticket without a transaction (e.g. the transaction was deleted) can be booked again
  const known = new Map(ticketsRes.data.filter((t) => t.ticketId && (t.transaction || t.pairedTransactionId || t.stateCode === 1)).map((t) => [ticketKey(t.ticketId!, t.executedOn), t]))
  const duplicates = new Set(csvRows.flatMap((r, i) => (r.ticketid && known.has(ticketKey(r.ticketid, r.executedon)) ? [i] : [])))
  // Newest earlier ticket of the same counterparty (account number first, then name) that is booked to a transaction
  const booked = ticketsRes.data.filter((t) => t.transaction)
  const pastBooking = (row: CsvRow) => {
    const name = normName(row.partnername)
    const ticket =
      (row.partneraccountnumber && booked.find((t) => t.partnerAccountNumber === row.partneraccountnumber)) ||
      (name && booked.find((t) => normName(t.partnerName) === name))
    const tx = ticket ? ticket.transaction : null
    if (!tx) return undefined
    const partnerRef = [tx.toAccount, tx.fromAccount].find((a) => a?.type === 'PAYMENT_PARTNER')
    const past: PastBooking = {
      partner: null,
      budgetId: tx.budget?.id ?? null,
      budgetName: tx.budget ? tx.budget.name ?? tx.budget.template?.name ?? null : null,
      budgetTemplateId: tx.budget?.templateId ?? null,
      planTemplateId: tx.budget?.plan.templateId ?? tx.plan?.templateId ?? null,
    }
    return { partner: partners.find((p) => p.id === partnerRef?.id), target: targetFromPast(past, targets, row.executedon) }
  }

  // Movements between own accounts hold the ticket of one account only; a row of the other account pairs with them
  const ownTicketIds = new Set(ticketsRes.data.map((t) => t.id))
  const pairedTxIds = new Set(ticketsRes.data.flatMap((t) => (t.pairedTransactionId ? [t.pairedTransactionId] : [])))
  const isOwn = (a: AccountRef | null) => !!a && a.type !== 'PAYMENT_PARTNER'
  const pairCandidates: Candidate[] = [...byTx.values()]
    .map((v) => v.tx)
    .filter((tx) =>
      !!tx.raw.bankTicketId && !ownTicketIds.has(tx.raw.bankTicketId) && !pairedTxIds.has(tx.id) && !!tx.executedOn &&
      isOwn(tx.from) && isOwn(tx.to) && (tx.from?.id === accountId || tx.to?.id === accountId))
    .map((tx) => ({ ...tx, pairOnly: true }))
  const usedPairs = new Set<string>()
  const suggestPair = (r: MatchResult): MatchResult => {
    if (r.isDuplicate) return r
    const outgoing = r.csvRow.amount < 0
    const rowTime = new Date(r.csvRow.executedon).getTime()
    const hit = pairCandidates.find((c) =>
      !usedPairs.has(c.id) && (outgoing ? c.from?.id === accountId : c.to?.id === accountId) &&
      Math.abs((c.amount ?? 0) - Math.abs(r.csvRow.amount)) < 0.005 &&
      Math.abs(c.executedOn!.getTime() - rowTime) <= 3 * 86_400_000)
    if (!hit) return r
    // Kept as a fallback for when the user clears a wrong regular match
    if (r.matched) return { ...r, pairSuggestion: hit }
    usedPairs.add(hit.id)
    return { ...r, matched: hit, pairSuggestion: hit, target: byTx.get(hit.id)?.target, confidence: 1 }
  }

  // Already imported rows show the transaction their ticket is linked to instead of a guess
  const results = matchAll(csvRows, candidates, partners, tagsRes.data, history, targets, duplicates, pastBooking).map((r) => {
    if (!r.isDuplicate) return suggestPair(r)
    const ticket = known.get(ticketKey(r.csvRow.ticketid, r.csvRow.executedon))!
    const link = ticket.pairedTransactionId ? byTx.get(ticket.pairedTransactionId) : linked.get(ticket.id)
    return { ...r, matched: link?.tx, target: link?.target, ticketDbId: ticket.id, paired: !!ticket.pairedTransactionId || ticket.stateCode === 1 }
  })

  return { results, candidates, pairCandidates, targets, partners, accounts: accountsRes.data, tags: tagsRes.data, accountId }
}
