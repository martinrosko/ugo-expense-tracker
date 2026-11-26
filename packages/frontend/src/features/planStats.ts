import { computePlannedOn } from './helpers'

export type TxSummary = {
  id: string
  name?: string | null
  amount: string | null
  plannedAmount: string | null
  plannedOn?: string | null
  dueDateConfig?: string | null
  executedOn: string | null
  type: 'TRANSACTION' | 'BALANCE'
  templateId?: string | null
  bankTicketId?: string | null
  /** A row of someone else's account: only dates, amounts and direction are known */
  masked?: boolean
  /** Whether the current user may act on the row; unset means yes */
  canEdit?: boolean
  fromAccount?: { type: string } | null
  toAccount?: { type: string } | null
}

export type BudgetWithTx = {
  id: string
  name: string | null
  amount: string | null
  planId: string
  statusCode?: number
  transactions: TxSummary[]
}

// ─── Transaction classification ──────────────────────────────────────────────

export const ASSET_TYPES = new Set(['CASH', 'BANK', 'INVESTMENT'])

export type TxKind = 'expense' | 'income' | 'transfer'

export function txKind(tx: TxSummary): TxKind {
  const from = tx.fromAccount?.type ?? ''
  const to = tx.toAccount?.type ?? ''
  const fromAsset = ASSET_TYPES.has(from)
  const toAsset = ASSET_TYPES.has(to)
  if (fromAsset && toAsset) return 'transfer'
  if (toAsset && !fromAsset) return 'income'
  return 'expense'
}

/** Return a signed amount: expense = negative, income = positive, transfer = 0 (ignored in totals) */
export function signedAmount(tx: TxSummary, raw: string | null): number {
  const v = parse(raw)
  const kind = txKind(tx)
  if (kind === 'transfer') return 0
  return kind === 'income' ? Math.abs(v) : -Math.abs(v)
}

// ─── Stats helpers ────────────────────────────────────────────────────────────

/** Returns true if the transaction falls within [from, to] based on executedOn or plannedOn */
export function inPeriod(tx: TxSummary, from: Date, to: Date, planStartDate?: string | null): boolean {
  const dateStr = tx.executedOn ?? tx.plannedOn ?? computePlannedOnLabel(tx.dueDateConfig, planStartDate)
  if (!dateStr) return true // no date — include (floating/unscheduled)
  const d = new Date(dateStr)
  return d >= from && d <= to
}

export function computePlannedOnLabel(dueDateConfig: string | null | undefined, planStartDate: string | null | undefined): string | null {
  const d = computePlannedOn(dueDateConfig, planStartDate);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parse(v: string | null | undefined): number {
  return v ? parseFloat(v) || 0 : 0
}

export function splitByKind(txs: TxSummary[], field: 'amount' | 'plannedAmount', opts?: { executedOnly?: boolean; unexecutedOnly?: boolean }): { inc: number; exp: number } {
  let inc = 0, exp = 0
  for (const t of txs) {
    if (opts?.executedOnly && t.executedOn === null) continue
    if (opts?.unexecutedOnly && t.executedOn !== null) continue
    const kind = txKind(t)
    const v = Math.abs(parse(t[field]))
    if (kind === 'income') inc += v
    else if (kind === 'expense') exp += v
  }
  return { inc, exp }
}

/** Compute the overlap ratio between the viewing period and the plan's lifespan */
export function periodPortion(from: Date | undefined, to: Date | undefined, planStart: string | null | undefined, planEnd: string | null | undefined): number {
  if (!from || !to || !planStart || !planEnd) return 1
  const ps = new Date(planStart)
  const pe = new Date(planEnd)
  if (isNaN(ps.getTime()) || isNaN(pe.getTime())) return 1
  const planDays = Math.round((pe.getTime() - ps.getTime()) / 86400000) + 1
  if (planDays <= 0) return 1
  // Clamp viewing window to plan bounds
  const clampedFrom = from < ps ? ps : from
  const clampedTo = to > pe ? pe : to
  const overlapDays = Math.round((clampedTo.getTime() - clampedFrom.getTime()) / 86400000) + 1
  if (overlapDays <= 0) return 0
  return overlapDays / planDays
}

export type BudgetStats = {
  planned: number; actual: number; reserved: number
  incPlanned: number; incActual: number; incReserved: number
  expPlanned: number; expActual: number; expReserved: number
}

export function budgetStats(b: BudgetWithTx, from?: Date, to?: Date, planStartDate?: string | null, planEndDate?: string | null, planCompleted = false): BudgetStats {
  const allTxs = (b.transactions ?? []).filter((t) => t.type === 'TRANSACTION')
  const txs = from && to ? allTxs.filter((t) => inPeriod(t, from, to, planStartDate)) : allTxs
  const actual = txs.filter((t) => t.executedOn !== null).reduce((s, t) => s + signedAmount(t, t.amount), 0)
  const txPlannedSum = txs.reduce((s, t) => s + signedAmount(t, t.plannedAmount), 0)
  // A completed budget keeps no envelope reservation; only its unexecuted transactions still reserve
  const completed = planCompleted || b.statusCode === 3
  // Budget envelope prorated to the viewing period
  const fullEnvelope = b.amount ? -Math.abs(parse(b.amount)) : 0
  const portion = periodPortion(from, to, planStartDate, planEndDate)
  const budgetEnvelope = fullEnvelope * portion
  const planned = budgetEnvelope + txPlannedSum
  // Reserved: remaining budget capacity after unplanned actuals, prorated to the period
  // Unplanned actuals are executed txs that have no dueDateConfig (ad-hoc spending); all of the budget's, not only those in the viewed period
  const unplannedActual = allTxs
    .filter((t) => t.executedOn !== null && !t.dueDateConfig)
    .reduce((s, t) => s + signedAmount(t, t.amount), 0)
  let reservation = completed ? 0 : fullEnvelope - unplannedActual // envelope minus what was already spent
  // Clamp: can't reserve more than the envelope, can't go below 0
  if (fullEnvelope <= 0) {
    reservation = Math.max(fullEnvelope, Math.min(0, reservation))
  } else {
    reservation = Math.min(fullEnvelope, Math.max(0, reservation))
  }
  // Prorate the reservation to the remaining active period within the viewing window
  if (reservation !== 0 && planStartDate && planEndDate && from && to) {
    const today = new Date()
    const pe = new Date(planEndDate)
    const ps = new Date(planStartDate)
    // The remainder is spread over the days left in the plan (from today, or the plan start if later); the window gets its share
    const activeFrom = today < ps ? ps : today
    const windowFrom = from > activeFrom ? from : activeFrom
    const activeTo = to > pe ? pe : to
    const activeInterval = Math.round((pe.getTime() - activeFrom.getTime()) / 86400000) + 1
    const periodInterval = Math.round((activeTo.getTime() - windowFrom.getTime()) / 86400000) + 1
    if (activeInterval > 0 && periodInterval > 0) {
      reservation = reservation * (periodInterval / activeInterval)
    } else {
      reservation = 0
    }
  }
  const _actS = splitByKind(txs, 'amount', { executedOnly: true })
  const _plnS = splitByKind(txs, 'plannedAmount')
  // Pending transactions from a template are committed spending on top of the envelope; in a completed budget all pending ones are
  const pendingTpl = txs.filter((t) => t.executedOn === null && (completed || t.templateId))
  const pendingTplSigned = pendingTpl.reduce((s, t) => s + signedAmount(t, t.plannedAmount), 0)
  const pendingTplSplit = splitByKind(pendingTpl, 'plannedAmount')
  return {
    planned, actual, reserved: reservation + pendingTplSigned,
    incPlanned: _plnS.inc, incActual: _actS.inc,
    incReserved: (reservation > 0 ? reservation : 0) + pendingTplSplit.inc,
    expPlanned: Math.abs(budgetEnvelope) + _plnS.exp, expActual: _actS.exp,
    expReserved: (reservation < 0 ? Math.abs(reservation) : 0) + pendingTplSplit.exp,
  }
}

export function planStats(plan: PlanLike, from?: Date, to?: Date): BudgetStats {
  const stats = openPlanStats(plan, from, to)
  // A scheduled plan has nothing executed yet, so everything planned is still to come
  if (plan.statusCode !== 2) return stats
  return { ...stats, actual: 0, incActual: 0, expActual: 0, reserved: stats.planned, incReserved: stats.incPlanned, expReserved: stats.expPlanned }
}

function openPlanStats(plan: PlanLike, from?: Date, to?: Date): BudgetStats {
  const bs = (plan.budgets ?? []).map((b) => budgetStats(b, from, to, plan.startDate, plan.endDate, plan.statusCode === 3))
  const allDirectTxs = (plan.transactions ?? []).filter((t) => t.type === 'TRANSACTION')
  const directTxs = from && to ? allDirectTxs.filter((t) => inPeriod(t, from, to, plan.startDate)) : allDirectTxs
  const directActual = directTxs.filter((t) => t.executedOn !== null).reduce((s, t) => s + signedAmount(t, t.amount), 0)
  const directPlanned = directTxs.reduce((s, t) => s + signedAmount(t, t.plannedAmount), 0)
  const directReserved = directTxs.filter((t) => t.executedOn === null).reduce((s, t) => s + signedAmount(t, t.plannedAmount), 0)
  const dAct = splitByKind(directTxs, 'amount', { executedOnly: true })
  const dPln = splitByKind(directTxs, 'plannedAmount')
  const dRes = splitByKind(directTxs, 'plannedAmount', { unexecutedOnly: true })
  return {
    planned: bs.reduce((s, b) => s + b.planned, 0) + directPlanned,
    actual: bs.reduce((s, b) => s + b.actual, 0) + directActual,
    reserved: bs.reduce((s, b) => s + b.reserved, 0) + directReserved,
    incPlanned: bs.reduce((s, b) => s + b.incPlanned, 0) + dPln.inc,
    expPlanned: bs.reduce((s, b) => s + b.expPlanned, 0) + dPln.exp,
    incActual: bs.reduce((s, b) => s + b.incActual, 0) + dAct.inc,
    expActual: bs.reduce((s, b) => s + b.expActual, 0) + dAct.exp,
    incReserved: bs.reduce((s, b) => s + b.incReserved, 0) + dRes.inc,
    expReserved: bs.reduce((s, b) => s + b.expReserved, 0) + dRes.exp,
  }
}

/** The part of a detailed plan the stats need */
export type PlanLike = {
  startDate: string | null
  endDate: string | null
  statusCode: number
  budgets: BudgetWithTx[]
  transactions: TxSummary[]
}

export function sumStats(list: BudgetStats[]): BudgetStats {
  const sum = (pick: (s: BudgetStats) => number) => list.reduce((total, s) => total + pick(s), 0)
  return {
    planned: sum((s) => s.planned), actual: sum((s) => s.actual), reserved: sum((s) => s.reserved),
    incPlanned: sum((s) => s.incPlanned), incActual: sum((s) => s.incActual), incReserved: sum((s) => s.incReserved),
    expPlanned: sum((s) => s.expPlanned), expActual: sum((s) => s.expActual), expReserved: sum((s) => s.expReserved),
  }
}
