import { computePlannedOn } from './helpers'

export type AccountRef = { id: string; name: string; type: string }
export type Account = AccountRef

export type RawTx = {
  id: string
  name: string | null
  amount: string | null
  plannedAmount: string | null
  plannedOn: string | null
  executedOn: string | null
  dueDateConfig: string | null
  fromAccountId: string | null
  toAccountId: string | null
  fromAccount: AccountRef | null
  toAccount: AccountRef | null
  budgetId: string | null
  type: string
  templateId: string | null
  template: {
    name: string | null
    plannedAmount: string | null
    plannedOn: string | null
    fromAccountId: string | null
    toAccountId: string | null
    dueDateConfig: string | null
  } | null
}

export type RawBudget = {
  id: string
  name: string | null
  amount: string | null
  statusCode: number
  template: { name: string | null; amount: string | null } | null
  transactions: RawTx[]
}

export type RawPlan = {
  id: string
  name: string | null
  startDate: string | null
  endDate: string | null
  intervalType: string
  isTemplate: boolean
  statusCode: number
  templateId: string | null
  template: { name: string | null } | null
  budgets: RawBudget[]
  transactions: RawTx[]
}

/** Transaction with template values resolved */
export type Tx = {
  id: string
  name: string
  plannedAmount: number | null
  amount: number | null
  plannedDate: Date | null
  executedOn: Date | null
  from: AccountRef | null
  to: AccountRef | null
  budgetId: string | null
  budgetName: string
  budgetCompleted: boolean
  templateId: string | null
  dueDateConfig: string | null
  raw: RawTx
}

const ASSET_TYPES = new Set(['CASH', 'BANK', 'INVESTMENT'])

/** Expense = -1, income = +1, transfer/unknown = 0 */
export function direction(from: AccountRef | null, to: AccountRef | null): number {
  const fromAsset = ASSET_TYPES.has(from?.type ?? '')
  const toAsset = ASSET_TYPES.has(to?.type ?? '')
  if (fromAsset && toAsset) return 0
  if (toAsset) return 1
  if (fromAsset) return -1
  return 0
}

export const num = (v: string | null | undefined): number | null => {
  const n = parseFloat(v ?? '')
  return isNaN(n) ? null : n
}

export function resolve(raw: RawTx, plan: RawPlan, budget: RawBudget | null, accounts: Map<string, Account>): Tx {
  const tpl = raw.template
  const dueDateConfig = raw.dueDateConfig ?? tpl?.dueDateConfig ?? null
  const plannedOn = raw.plannedOn ?? tpl?.plannedOn ?? null
  const plannedDate = plannedOn ? new Date(plannedOn) : computePlannedOn(dueDateConfig, plan.startDate)
  const fromId = raw.fromAccountId ?? tpl?.fromAccountId
  const toId = raw.toAccountId ?? tpl?.toAccountId
  return {
    id: raw.id,
    name: raw.name ?? tpl?.name ?? '(unnamed)',
    plannedAmount: num(raw.plannedAmount ?? tpl?.plannedAmount),
    amount: num(raw.amount),
    plannedDate,
    executedOn: raw.executedOn ? new Date(raw.executedOn) : null,
    from: raw.fromAccount ?? (fromId ? accounts.get(fromId) ?? null : null),
    to: raw.toAccount ?? (toId ? accounts.get(toId) ?? null : null),
    budgetId: budget?.id ?? null,
    budgetName: budget ? (budget.name ?? budget.template?.name ?? '(unnamed)') : 'General',
    budgetCompleted: budget?.statusCode === 3,
    templateId: raw.templateId,
    dueDateConfig,
    raw,
  }
}

/** All TRANSACTION-type transactions of the plan (direct and in budgets) with template values resolved. */
export function resolveAll(plan: RawPlan, accounts: Map<string, Account>): Tx[] {
  return [
    ...plan.transactions.map((t) => resolve(t, plan, null, accounts)),
    ...plan.budgets.flatMap((b) => b.transactions.map((t) => resolve(t, plan, b, accounts))),
  ].filter((t) => t.raw.type === 'TRANSACTION')
}

/** A pending transaction whose planned day is before today */
export function isOverdue(t: Tx): boolean {
  if (t.executedOn !== null || !t.plannedDate) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return t.plannedDate < today
}

export const byPlannedDate = (a: Tx, b: Tx) => (a.plannedDate?.getTime() ?? Infinity) - (b.plannedDate?.getTime() ?? Infinity)
export const byExecutedNewestFirst = (a: Tx, b: Tx) => b.executedOn!.getTime() - a.executedOn!.getTime()

export function apiError(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: string; message?: string } }; message?: string }
  return e.response?.data?.error ?? e.response?.data?.message ?? e.message ?? fallback
}
