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
  const known = new Map(ticketsRes.data.filter((t) => t.ticketId).map((t) => [ticketKey(t.ticketId!, t.executedOn), t.id]))
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

  // Already imported rows show the transaction their ticket is linked to instead of a guess
  const results = matchAll(csvRows, candidates, partners, tagsRes.data, history, targets, duplicates, pastBooking).map((r) => {
    if (!r.isDuplicate) return r
    const link = linked.get(known.get(ticketKey(r.csvRow.ticketid, r.csvRow.executedon))!)
    return { ...r, matched: link?.tx, target: link?.target }
  })

  return { results, candidates, targets, partners, accounts: accountsRes.data, tags: tagsRes.data, accountId }
}
