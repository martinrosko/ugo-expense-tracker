import apiClient from '../../api/apiClient'
import { planLabel } from '../planLabel'
import { resolveAll, type AccountRef, type RawPlan, type Tx } from '../planTransactions'
import type { CsvRow } from '../csv/types'
import { matchAll } from './matcher'
import { targetKey } from './rules'
import type { Candidate, MatchResult, TagRef, Target } from './types'

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
    apiClient.get<{ ticketId: string | null }[]>('/api/bank-tickets', { params: { accountId } }),
  ])

  // Newest plan first, which is the order the partner history is searched in
  const planItems = [...active.data, ...completed.data].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))
  const details = await Promise.all(planItems.map((p) => apiClient.get<RawPlan>(`/api/plans/${p.id}`)))
  const accountMap = new Map(accountsRes.data.map((a) => [a.id, a]))

  const candidates: Candidate[] = []
  const targets: Target[] = []
  const history: { tx: Tx; target: Target }[] = []
  planItems.forEach((item, i) => {
    const plan = details[i].data
    const label = planLabel(item)
    const completedPlan = item.statusCode === 3
    const planTargets: Target[] = [
      {
        key: targetKey(plan.id, null), planId: plan.id, budgetId: null, budgetName: null,
        label: `${label} › General`, completed: completedPlan, startDate: item.startDate, endDate: item.endDate,
      },
      ...plan.budgets.map((b) => {
        const budgetName = b.name ?? b.template?.name ?? '(unnamed)'
        return {
          key: targetKey(plan.id, b.id), planId: plan.id, budgetId: b.id, budgetName,
          label: `${label} › ${budgetName}`, completed: completedPlan, startDate: item.startDate, endDate: item.endDate,
        }
      }),
    ]
    targets.push(...planTargets)
    const txs = resolveAll(plan, accountMap)
    for (const tx of txs) {
      const target = planTargets.find((t) => t.budgetId === tx.budgetId)
      if (target) history.push({ tx, target })
      // Planned transactions of active plans, and executed ones that still have no bank ticket
      if (!tx.raw.bankTicketId && (tx.executedOn || (item.statusCode === 1 && !tx.budgetCompleted))) {
        candidates.push({ ...tx, planId: plan.id, planLabel: label })
      }
    }
  })

  const partners = accountsRes.data.filter((a) => a.type === 'PAYMENT_PARTNER')
  const known = new Set(ticketsRes.data.map((t) => t.ticketId).filter(Boolean))
  const results = matchAll(csvRows, candidates, partners, tagsRes.data, history, targets)
    .map((r) => ({ ...r, isDuplicate: !!r.csvRow.ticketid && known.has(r.csvRow.ticketid) }))

  return { results, candidates, targets, partners, accounts: accountsRes.data, tags: tagsRes.data, accountId }
}
