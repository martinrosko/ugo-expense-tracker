import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Typography,
  Space,
  Button,
  Radio,
  Collapse,
  Progress,
  Tag,
  Spin,
  Alert,
  Row,
  Col,
  Statistic,
  Table,
  DatePicker,
  Tooltip,
  Switch,
  message,
  Modal,
  Form,
  Input,
  Select,
} from 'antd'
import { LeftOutlined, RightOutlined, UnorderedListOutlined, EditOutlined, DeleteOutlined, PlusOutlined, StopOutlined, SyncOutlined, PlayCircleOutlined, HistoryOutlined, EyeOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import { useLocation, useNavigate } from 'react-router-dom'
import apiClient from '../api/apiClient'
import { computePlannedOn } from '../features/helpers'
import { planLabel } from '../features/planLabel'
import ChangeRecurrenceModal from '../components/ChangeRecurrenceModal'
import ActivatePlanModal from '../components/ActivatePlanModal'
import RowActions, { type RowAction } from '../components/RowActions'
import { usePlanTxActions, type TxActionContext } from '../features/usePlanTxActions'
import LogTransactionModal from '../components/LogTransactionModal'

dayjs.extend(isoWeek)

const { Title, Text } = Typography

// ─── Types ───────────────────────────────────────────────────────────────────

type TxSummary = {
  id: string
  name?: string | null
  amount: string | null
  plannedAmount: string | null
  plannedOn?: string | null
  dueDateConfig?: string | null
  executedOn: string | null
  type: 'TRANSACTION' | 'BALANCE'
  templateId?: string | null
  fromAccount?: { type: string } | null
  toAccount?: { type: string } | null
}

type BudgetWithTx = {
  id: string
  name: string | null
  amount: string | null
  planId: string
  statusCode?: number
  transactions: TxSummary[]
}

type PlanDetailed = {
  id: string
  name: string | null
  startDate: string | null
  endDate: string | null
  intervalType: string
  templateIntervalType?: string | null
  templateId?: string | null
  isTemplate: boolean
  stateCode: number
  statusCode: number
  budgets: BudgetWithTx[]
  transactions: TxSummary[]
}

// ─── Period helpers ───────────────────────────────────────────────────────────

type PeriodMode = 'active' | 'week' | 'month' | 'year' | 'template' | 'templates'
type PeriodKind = 'week' | 'month' | 'year'

function isPeriodKind(m: PeriodMode): m is PeriodKind {
  return m === 'week' || m === 'month' || m === 'year'
}

type PlansOverviewState = {
  mode?: PeriodMode
  templateId?: string | null // template shown in 'template' mode
  offset?: number
  splitView?: boolean
  expandedTemplateIds?: string[]
  expandedPlanIds?: string[] | null // null = use per-view defaults
  savedDates?: Partial<Record<PeriodKind, string>> // last viewed period start (YYYY-MM-DD) per mode
}

const STATE_STORAGE_KEY = 'plansOverviewState'
const INITIAL_VISIBLE = 5
const LOAD_MORE_STEP = 10

function loadSavedState(): PlansOverviewState {
  try {
    return JSON.parse(sessionStorage.getItem(STATE_STORAGE_KEY) ?? '{}') as PlansOverviewState
  } catch {
    return {}
  }
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

/** Format a local Date as YYYY-MM-DD without UTC conversion */
function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Compute the offset (relative to today) for a dayjs value picked by the user */
function computeOffset(mode: PeriodKind, picked: Dayjs): number {
  const now = new Date()
  if (mode === 'month') {
    return (picked.year() - now.getFullYear()) * 12 + (picked.month() - now.getMonth())
  }
  if (mode === 'year') {
    return picked.year() - now.getFullYear()
  }
  // week: ISO Monday-based
  const dow = (now.getDay() + 6) % 7
  const currentMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow)
  const pickedMonday = picked.isoWeekday(1).startOf('day').toDate()
  return Math.round((pickedMonday.getTime() - currentMonday.getTime()) / (7 * 86400000))
}

function getPeriod(mode: PeriodKind, offset: number): { from: Date; to: Date; label: string } {
  const now = new Date()
  if (mode === 'week') {
    const dow = (now.getDay() + 6) % 7 // Mon=0 … Sun=6
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + offset * 7)
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6, 23, 59, 59, 999)
    return { from: monday, to: sunday, label: `Week ${getISOWeek(monday)}, ${monday.getFullYear()}` }
  }
  if (mode === 'month') {
    const base = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const from = new Date(base.getFullYear(), base.getMonth(), 1)
    const to = new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59, 999)
    return { from, to, label: from.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }
  }
  const year = now.getFullYear() + offset
  return {
    from: new Date(year, 0, 1),
    to: new Date(year, 11, 31, 23, 59, 59, 999),
    label: String(year),
  }
}

// ─── Transaction classification ──────────────────────────────────────────────

const ASSET_TYPES = new Set(['CASH', 'BANK', 'INVESTMENT'])

type TxKind = 'expense' | 'income' | 'transfer'

function txKind(tx: TxSummary): TxKind {
  const from = tx.fromAccount?.type ?? ''
  const to = tx.toAccount?.type ?? ''
  const fromAsset = ASSET_TYPES.has(from)
  const toAsset = ASSET_TYPES.has(to)
  if (fromAsset && toAsset) return 'transfer'
  if (toAsset && !fromAsset) return 'income'
  return 'expense'
}

/** Return a signed amount: expense = negative, income = positive, transfer = 0 (ignored in totals) */
function signedAmount(tx: TxSummary, raw: string | null): number {
  const v = parse(raw)
  const kind = txKind(tx)
  if (kind === 'transfer') return 0
  return kind === 'income' ? Math.abs(v) : -Math.abs(v)
}

// ─── Stats helpers ────────────────────────────────────────────────────────────

/** Returns true if the transaction falls within [from, to] based on executedOn or plannedOn */
function inPeriod(tx: TxSummary, from: Date, to: Date, planStartDate?: string | null): boolean {
  const dateStr = tx.executedOn ?? tx.plannedOn ?? computePlannedOnLabel(tx.dueDateConfig, planStartDate)
  if (!dateStr) return true // no date — include (floating/unscheduled)
  const d = new Date(dateStr)
  return d >= from && d <= to
}

function computePlannedOnLabel(dueDateConfig: string | null | undefined, planStartDate: string | null | undefined): string | null {
  const d = computePlannedOn(dueDateConfig, planStartDate);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parse(v: string | null | undefined): number {
  return v ? parseFloat(v) || 0 : 0
}

function splitByKind(txs: TxSummary[], field: 'amount' | 'plannedAmount', opts?: { executedOnly?: boolean; unexecutedOnly?: boolean }): { inc: number; exp: number } {
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

function fmt(v: number): string {
  return (v < 0 ? '-' : '') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

function amountColor(v: number) {
  return v < 0 ? '#cf1322' : v > 0 ? '#3f8600' : undefined
}

/** Compute the overlap ratio between the viewing period and the plan's lifespan */
function periodPortion(from: Date | undefined, to: Date | undefined, planStart: string | null | undefined, planEnd: string | null | undefined): number {
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

type BudgetStats = {
  planned: number; actual: number; reserved: number
  incPlanned: number; incActual: number; incReserved: number
  expPlanned: number; expActual: number; expReserved: number
}

function budgetStats(b: BudgetWithTx, from?: Date, to?: Date, planStartDate?: string | null, planEndDate?: string | null): BudgetStats {
  const allTxs = (b.transactions ?? []).filter((t) => t.type === 'TRANSACTION')
  const txs = from && to ? allTxs.filter((t) => inPeriod(t, from, to, planStartDate)) : allTxs
  const actual = txs.filter((t) => t.executedOn !== null).reduce((s, t) => s + signedAmount(t, t.amount), 0)
  const txPlannedSum = txs.reduce((s, t) => s + signedAmount(t, t.plannedAmount), 0)
  // Budget envelope prorated to the viewing period
  const fullEnvelope = b.amount ? -Math.abs(parse(b.amount)) : 0
  const portion = periodPortion(from, to, planStartDate, planEndDate)
  const budgetEnvelope = fullEnvelope * portion
  const planned = budgetEnvelope + txPlannedSum
  // Reserved: remaining budget capacity after unplanned actuals, prorated to the period
  // Unplanned actuals are executed txs that have no dueDateConfig (ad-hoc spending)
  const unplannedActual = txs
    .filter((t) => t.executedOn !== null && !t.dueDateConfig)
    .reduce((s, t) => s + signedAmount(t, t.amount), 0)
  let reservation = fullEnvelope - unplannedActual // envelope minus what was already spent
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
    // Active period starts from today (or from filter.from if later)
    const activeFrom = from > today ? from : today < ps ? ps : today
    const activeTo = to > pe ? pe : to
    const activeInterval = Math.round((pe.getTime() - activeFrom.getTime()) / 86400000) + 1
    const periodInterval = Math.round((activeTo.getTime() - activeFrom.getTime()) / 86400000) + 1
    if (activeInterval > 0 && periodInterval > 0) {
      reservation = reservation * (periodInterval / activeInterval)
    } else {
      reservation = 0
    }
  }
  const _actS = splitByKind(txs, 'amount', { executedOnly: true })
  const _plnS = splitByKind(txs, 'plannedAmount')
  // Pending transactions from a template are committed spending on top of the envelope
  const pendingTpl = txs.filter((t) => t.executedOn === null && t.templateId)
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

function planStats(plan: PlanDetailed, from?: Date, to?: Date): BudgetStats {
  const bs = (plan.budgets ?? []).map((b) => budgetStats(b, from, to, plan.startDate, plan.endDate))
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

function execProgress(stats: { planned: number; actual: number; reserved: number }): { pct: number; rawPct: number; status: 'success' | 'normal' | 'exception'; flipped: boolean } {
  if (stats.planned === 0) return { pct: 0, rawPct: 0, status: 'normal', flipped: false }
  const used = stats.actual + stats.reserved
  // Sign mismatch: expense budget but got income (or vice versa) — budget wasn't consumed as planned
  const flipped = (stats.planned < 0 && used > 0) || (stats.planned > 0 && used < 0)
  if (flipped) return { pct: 0, rawPct: 0, status: 'success', flipped: true }
  const pct = Math.round(Math.abs(used) / Math.abs(stats.planned) * 100)
  const isIncome = stats.planned > 0
  const status = pct > 100
    ? (isIncome ? 'success' : 'exception')
    : pct >= 90 ? 'normal' : 'success'
  return { pct: Math.min(pct, 100), rawPct: pct, status, flipped: false }
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<number, string> = { 0: 'Draft', 1: 'Active', 2: 'Scheduled', 3: 'Completed', 4: 'Cancelled' }
const STATUS_COLOR: Record<number, string> = { 0: 'default', 1: 'green', 2: 'blue', 3: 'cyan', 4: 'red' }

const STATUS_GROUPS = [
  { key: '1', label: 'Active Plans', codes: [1] },
  { key: '2', label: 'Scheduled Plans', codes: [2] },
  { key: '3', label: 'Completed Plans', codes: [3] },
  { key: '0', label: 'Draft Plans', codes: [0] },
]

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Segmented bar: actual (solid) + reserved (medium) vs planned target */
function SplitBar({ actual, reserved, planned, kind }: { actual: number; reserved: number; planned: number; kind: 'income' | 'expense' }) {
  const used = actual + reserved
  const total = Math.max(planned, used)
  if (total === 0) return <span style={{ fontSize: 11, color: '#999' }}>—</span>

  const actualPct = (actual / total) * 100
  const reservedPct = (reserved / total) * 100
  const plannedPct = (planned / total) * 100
  const overAchieved = used > planned

  const solid = kind === 'income' ? '#389e0d' : '#cf1322'
  const medium = kind === 'income' ? 'rgba(82,196,26,0.40)' : 'rgba(255,77,79,0.40)'
  const light = kind === 'income' ? 'rgba(82,196,26,0.18)' : 'rgba(255,77,79,0.18)'

  const pctLabel = planned > 0 ? Math.round((used / planned) * 100) : 0

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <div style={{ width: 80, height: 6, borderRadius: 3, background: '#f0f0f0', position: 'relative', overflow: 'hidden' }}>
        {/* Light fill up to planned (shows unfilled target) */}
        {!overAchieved && (
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${plannedPct}%`, borderRadius: 3, background: light }} />
        )}
        {/* Reserved (actual + reserved together) */}
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(actualPct + reservedPct, 100)}%`, borderRadius: 3, background: medium }} />
        {/* Actual (solid) */}
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(actualPct, 100)}%`, borderRadius: 3, background: solid }} />
        {/* Planned marker when over-achieved */}
        {overAchieved && planned > 0 && (
          <div style={{ position: 'absolute', left: `${plannedPct}%`, top: -1, bottom: -1, width: 2, background: 'white', opacity: 0.5, borderRadius: 1 }} />
        )}
      </div>
      <span style={{ fontSize: 11, minWidth: 30, textAlign: 'right' }}>{pctLabel}%</span>
    </div>
  )
}

function SplitAmount({ inc, exp }: { inc: number; exp: number }) {
  if (inc === 0 && exp === 0) return <span style={{ color: '#999' }}>—</span>
  return (
    <div style={{ lineHeight: 1.4 }}>
      {inc > 0 && <div style={{ color: '#3f8600' }}>{fmt(inc)}</div>}
      {exp > 0 && <div style={{ color: '#cf1322' }}>{fmt(-exp)}</div>}
    </div>
  )
}

type BudgetRow = {
  key: string; name: string; planned: number; actual: number; reserved: number
  incPlanned: number; incActual: number; incReserved: number; expPlanned: number; expActual: number; expReserved: number
  pct: number; rawPct: number; status: 'success' | 'normal' | 'exception'; flipped: boolean
  /** Budget size (envelope), negative like an expense; null when the budget has none */
  envelope?: number | null
  /** Executed transactions that were not planned (no template, no planned amount or due day) */
  unplanned?: { total: number; inc: number; exp: number }
  /** Reserved without the pending transactions that are listed as child rows */
  ownReserved?: { total: number; inc: number; exp: number }
  children?: TxTreeRow[]
}
type TxTreeRow = { key: string; tx: TxSummary; budgetCompleted: boolean }
type TableRow = BudgetRow | TxTreeRow
type Amt = { total: number; inc: number; exp: number }
const ZERO: Amt = { total: 0, inc: 0, exp: 0 }

const isTxTreeRow = (row: TableRow): row is TxTreeRow => 'tx' in row

const SMALL = { fontSize: 12 } as const

function shortDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric' }) : '—'
}

function plannedDateOf(tx: TxSummary, planStartDate?: string | null): string | null {
  return tx.plannedOn ?? computePlannedOnLabel(tx.dueDateConfig, planStartDate)
}

/** Pending transactions first (by planned date), then executed ones, newest first; unplanned ones are left out */
function txChildren(txs: TxSummary[], from: Date | undefined, to: Date | undefined, planStartDate: string | null | undefined, budgetCompleted: boolean): TxTreeRow[] | undefined {
  const all = txs.filter((t) => t.type === 'TRANSACTION' && isPlannedTx(t))
  const inRange = from && to ? all.filter((t) => inPeriod(t, from, to, planStartDate)) : all
  const time = (v: string | null) => (v ? new Date(v).getTime() : Infinity)
  const pending = inRange.filter((t) => t.executedOn === null).sort((a, b) => time(plannedDateOf(a, planStartDate)) - time(plannedDateOf(b, planStartDate)))
  const executed = inRange.filter((t) => t.executedOn !== null).sort((a, b) => time(b.executedOn) - time(a.executedOn))
  const rows = [...pending, ...executed].map((tx) => ({ key: tx.id, tx, budgetCompleted }))
  return rows.length > 0 ? rows : undefined
}

const isPlannedTx = (t: TxSummary) => !!t.templateId || t.plannedAmount !== null || !!t.dueDateConfig

/** Reserved amount of pending transactions in the period that match the filter */
function pendingReserved(txs: TxSummary[], from: Date | undefined, to: Date | undefined, planStartDate: string | null | undefined, match: (t: TxSummary) => boolean) {
  const pending = txs.filter((t) => t.type === 'TRANSACTION' && t.executedOn === null && match(t) && (!from || !to || inPeriod(t, from, to, planStartDate)))
  const split = splitByKind(pending, 'plannedAmount')
  return { total: pending.reduce((s, t) => s + signedAmount(t, t.plannedAmount), 0), inc: split.inc, exp: split.exp }
}

function withoutAmounts(stats: BudgetStats, pending: { total: number; inc: number; exp: number }) {
  return { total: stats.reserved - pending.total, inc: stats.incReserved - pending.inc, exp: stats.expReserved - pending.exp }
}

/** Sum of executed unplanned transactions in the period */
function unplannedExecuted(txs: TxSummary[], from: Date | undefined, to: Date | undefined, planStartDate: string | null | undefined) {
  const inRange = txs.filter((t) => t.type === 'TRANSACTION' && t.executedOn !== null && !isPlannedTx(t) && (!from || !to || inPeriod(t, from, to, planStartDate)))
  const split = splitByKind(inRange, 'amount')
  return { total: inRange.reduce((s, t) => s + signedAmount(t, t.amount), 0), inc: split.inc, exp: split.exp }
}

function txSplit(tx: TxSummary, raw: string | null): { inc: number; exp: number } {
  const kind = txKind(tx)
  const v = Math.abs(parse(raw))
  return { inc: kind === 'income' ? v : 0, exp: kind === 'expense' ? v : 0 }
}

function BudgetTable({ budgets, directTxs, scheduled, from, to, planStartDate, planEndDate, planId, planName, planStatusCode, splitView, txActions }: { budgets: BudgetWithTx[]; directTxs?: TxSummary[]; scheduled?: boolean; from?: Date; to?: Date; planStartDate?: string | null; planEndDate?: string | null; planId?: string; planName?: string | null; planStatusCode?: number; splitView?: boolean; txActions?: (ctx: TxActionContext) => RowAction[] }) {
  const navigate = useNavigate()
  const [expandedKeys, setExpandedKeys] = useState<string[]>(() => (planStatusCode === 1 ? [...budgets.map((b) => b.id), '__direct__'] : []))
  // An expanded budget shows its own size, since the rows below carry the amounts; collapsed it shows the totals
  const isExpanded = (row: BudgetRow) => !!row.children && expandedKeys.includes(row.key)
  const rows: BudgetRow[] = (budgets ?? []).map((b) => {
    const s = budgetStats(b, from, to, planStartDate, planEndDate)
    const ep = execProgress(s)
    return { key: b.id, name: b.name ?? '—', ...s, pct: ep.pct, rawPct: ep.rawPct, status: ep.status, flipped: ep.flipped, envelope: b.amount ? -Math.abs(parse(b.amount)) : null, unplanned: unplannedExecuted(b.transactions ?? [], from, to, planStartDate), ownReserved: withoutAmounts(s, pendingReserved(b.transactions ?? [], from, to, planStartDate, (t) => !!t.templateId)), children: txChildren(b.transactions ?? [], from, to, planStartDate, b.statusCode === 3) }
  })

  // Add uncategorized row if there are direct plan transactions
  const allDirect = (directTxs ?? []).filter((t) => t.type === 'TRANSACTION')
  const filteredDirect = from && to ? allDirect.filter((t) => inPeriod(t, from, to, planStartDate)) : allDirect
  if (filteredDirect.length > 0) {
    const actual = filteredDirect.filter((t) => t.executedOn !== null).reduce((s, t) => s + signedAmount(t, t.amount), 0)
    const reserved = filteredDirect.filter((t) => t.executedOn === null).reduce((s, t) => s + signedAmount(t, t.plannedAmount), 0)
    const planned = filteredDirect.reduce((s, t) => s + signedAmount(t, t.plannedAmount), 0)
    const dActS = splitByKind(filteredDirect, 'amount', { executedOnly: true })
    const dPlnS = splitByKind(filteredDirect, 'plannedAmount')
    const dResS = splitByKind(filteredDirect, 'plannedAmount', { unexecutedOnly: true })
    const ep = execProgress({ planned, actual, reserved })
    rows.push({ key: '__direct__', name: 'General', planned, actual, reserved, incPlanned: dPlnS.inc, incActual: dActS.inc, incReserved: dResS.inc, expPlanned: dPlnS.exp, expActual: dActS.exp, expReserved: dResS.exp, pct: ep.pct, rawPct: ep.rawPct, status: ep.status, flipped: ep.flipped, unplanned: unplannedExecuted(directTxs ?? [], from, to, planStartDate), ownReserved: withoutAmounts({ planned, actual, reserved, incPlanned: dPlnS.inc, incActual: dActS.inc, incReserved: dResS.inc, expPlanned: dPlnS.exp, expActual: dActS.exp, expReserved: dResS.exp }, pendingReserved(directTxs ?? [], from, to, planStartDate, () => true)), children: txChildren(directTxs ?? [], from, to, planStartDate, false) })
  }

  const sumOf = (pick: (r: BudgetRow) => Amt): Amt => rows.reduce((s, r) => { const a = pick(r); return { total: s.total + a.total, inc: s.inc + a.inc, exp: s.exp + a.exp } }, ZERO)
  const totalActual = sumOf((r) => ({ total: r.actual, inc: r.incActual, exp: r.expActual }))
  const totalReserved = sumOf((r) => ({ total: r.reserved, inc: r.incReserved, exp: r.expReserved }))
  const totalPlanned = sumOf((r) => ({ total: r.planned, inc: r.incPlanned, exp: r.expPlanned }))
  const plus = (a: Amt, b: Amt): Amt => ({ total: a.total + b.total, inc: a.inc + b.inc, exp: a.exp + b.exp })

  const txAmount = (tx: TxSummary, raw: string | null) => {
    if (splitView) {
      const { inc, exp } = txSplit(tx, raw)
      return <span style={SMALL}><SplitAmount inc={inc} exp={exp} /></span>
    }
    const v = signedAmount(tx, raw)
    return <span style={{ ...SMALL, color: amountColor(v) }}>{fmt(v)}</span>
  }

  // What a row shows as Actual and Reserved: its own amounts for a transaction, the share not listed below for an expanded budget
  const shown = (row: TableRow): { actual: Amt; reserved: Amt } => {
    if (isTxTreeRow(row)) {
      const t = row.tx
      if (t.executedOn !== null) {
        const s = txSplit(t, t.amount)
        return { actual: { total: signedAmount(t, t.amount), ...s }, reserved: ZERO }
      }
      const s = txSplit(t, t.plannedAmount)
      return { actual: ZERO, reserved: { total: signedAmount(t, t.plannedAmount), ...s } }
    }
    if (isExpanded(row)) return { actual: row.unplanned ?? ZERO, reserved: row.ownReserved ?? ZERO }
    return {
      actual: { total: row.actual, inc: row.incActual, exp: row.expActual },
      reserved: { total: row.reserved, inc: row.incReserved, exp: row.expReserved },
    }
  }

  const amountCell = (row: TableRow, a: Amt) => {
    // Child rows and expanded budgets leave empty amounts blank; collapsed budgets always show theirs
    if ((isTxTreeRow(row) || isExpanded(row)) && a.total === 0 && a.inc === 0 && a.exp === 0) return null
    const body = splitView ? <SplitAmount inc={a.inc} exp={a.exp} /> : <span style={{ color: amountColor(a.total) }}>{fmt(a.total)}</span>
    return isTxTreeRow(row) ? <span style={SMALL}>{body}</span> : body
  }

  const summaryCell = (a: Amt) => (splitView ? <SplitAmount inc={a.inc} exp={a.exp} /> : <span style={{ color: amountColor(a.total) }}>{fmt(a.total)}</span>)

  return (
    <div style={{ padding: '0 0px' }}>
      <Table<TableRow>
        dataSource={rows}
        pagination={false}
        size="small"
        rowKey="key"
        expandable={{ expandedRowKeys: expandedKeys, onExpandedRowsChange: (keys) => setExpandedKeys(keys.map(String)), indentSize: 16 }}
        summary={() => (
          <Table.Summary.Row style={{ fontWeight: 600 }}>
            <Table.Summary.Cell index={0}>Total</Table.Summary.Cell>
            {!scheduled && (
              <>
                <Table.Summary.Cell index={1} align="right">{summaryCell(totalActual)}</Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right">{summaryCell(totalReserved)}</Table.Summary.Cell>
              </>
            )}
            <Table.Summary.Cell index={scheduled ? 1 : 3} align="right">{summaryCell(totalPlanned)}</Table.Summary.Cell>
            {!scheduled && <Table.Summary.Cell index={4} align="right">{summaryCell(plus(totalActual, totalReserved))}</Table.Summary.Cell>}
            <Table.Summary.Cell index={scheduled ? 2 : 5} />
          </Table.Summary.Row>
        )}
        columns={[
          {
            title: 'Name', key: 'name', ellipsis: true,
            render: (_: unknown, row: TableRow) => {
              if (!isTxTreeRow(row)) return row.name
              const t = row.tx
              const pending = t.executedOn === null
              return (
                <span style={{ ...SMALL, color: pending ? '#8c8c8c' : undefined }}>
                  {shortDate(pending ? plannedDateOf(t, planStartDate) : t.executedOn)} · {t.name ?? '(unnamed)'}
                </span>
              )
            },
          },
          ...(!scheduled ? [
            {
              title: 'Actual',
              key: 'actual',
              align: 'right' as const,
              width: 110,
              render: (_: unknown, row: TableRow) => amountCell(row, shown(row).actual),
            },
            {
              title: 'Reserved',
              key: 'reserved',
              align: 'right' as const,
              width: 110,
              render: (_: unknown, row: TableRow) => amountCell(row, shown(row).reserved),
            },
          ] : []),
          {
            title: 'Planned',
            key: 'planned',
            align: 'right' as const,
            width: 110,
            render: (_: unknown, row: TableRow) => {
              if (isTxTreeRow(row)) return txAmount(row.tx, row.tx.plannedAmount)
              if (isExpanded(row)) {
                if (row.envelope == null) return null
                return splitView
                  ? <SplitAmount inc={0} exp={Math.abs(row.envelope)} />
                  : <span style={{ color: amountColor(row.envelope) }}>{fmt(row.envelope)}</span>
              }
              return splitView
                ? <SplitAmount inc={row.incPlanned} exp={row.expPlanned} />
                : <span style={{ color: amountColor(row.planned) }}>{fmt(row.planned)}</span>
            },
          },
          ...(!scheduled ? [
            {
              title: 'Projected',
              key: 'projected',
              align: 'right' as const,
              width: 110,
              render: (_: unknown, row: TableRow) => {
                const { actual, reserved } = shown(row)
                return amountCell(row, plus(actual, reserved))
              },
            },
          ] : []),          {
            title: '',
            key: 'actions',
            width: 60,
            align: 'right' as const,
            render: (_: unknown, row: TableRow) => {
              if (isTxTreeRow(row)) {
                if (!txActions || !planId || planStatusCode === undefined) return null
                return (
                  <RowActions
                    actions={txActions({
                      id: row.tx.id, planId, planStatus: planStatusCode, budgetCompleted: row.budgetCompleted,
                      templateId: row.tx.templateId ?? null, executed: row.tx.executedOn !== null,
                    })}
                  />
                )
              }
              if (row.key === '__direct__') {
                if (!planId) return null
                const qs = new URLSearchParams({ planId, ...(planName ? { planName } : {}) })
                return (
                  <Tooltip title="View transactions">
                    <Button size="small" type="text" icon={<UnorderedListOutlined />}
                      onClick={(e) => { e.stopPropagation(); navigate(`/transactions?${qs}`) }} />
                  </Tooltip>
                )
              }
              const budget = budgets.find((b) => b.id === row.key)
              if (!budget) return null
              const qs = new URLSearchParams({ budgetId: budget.id, budgetName: row.name, ...(planName ? { planName } : {}) })
              return (
                <Tooltip title="View transactions">
                  <Button size="small" type="text" icon={<UnorderedListOutlined />}
                    onClick={(e) => { e.stopPropagation(); navigate(`/transactions?${qs}`) }} />
                </Tooltip>
              )
            },
          },
        ]}
      />
    </div>
  )
}
function PlanHeader({ plan, stats, splitView, onDiscard, onChangeRecurrence, onActivate, onShowOccurrences }: { plan: PlanDetailed; stats: BudgetStats; splitView?: boolean; onDiscard?: (plan: PlanDetailed) => void; onChangeRecurrence?: (plan: PlanDetailed) => void; onActivate?: (plan: PlanDetailed) => void; onShowOccurrences?: (plan: PlanDetailed) => void }) {
  const navigate = useNavigate()
  const dateRange = [plan.startDate, plan.endDate]
    .map((d) => (d ? new Date(d).toLocaleDateString('sk-SK') : ''))
    .filter(Boolean)
    .join(' – ')

  const scheduled = plan.statusCode === 2
  const ep = execProgress(stats)
  const recurring = !!plan.templateIntervalType && plan.templateIntervalType !== 'ONE_TIME'

  const actions: RowAction[] = [
    ...(plan.statusCode === 1 && !plan.templateId && onDiscard
      ? [{
        key: 'discard', label: 'Discard plan', icon: <StopOutlined />, danger: true,
        confirm: { title: 'Discard this plan?', description: 'It has no template anymore and will be marked as Cancelled.', okText: 'Discard' },
        onClick: () => onDiscard(plan),
      }]
      : []),
    ...(plan.statusCode === 0 && !plan.isTemplate && !plan.templateId && plan.intervalType === 'ONE_TIME' && onActivate
      ? [{ key: 'activate', label: 'Activate plan', icon: <PlayCircleOutlined />, onClick: () => onActivate(plan) }]
      : []),
    ...(plan.templateId && recurring && onShowOccurrences
      ? [{ key: 'occurrences', label: 'Show all occurrences', icon: <HistoryOutlined />, onClick: () => onShowOccurrences(plan) }]
      : []),
    ...((plan.statusCode === 1 || plan.statusCode === 2) && plan.templateId && recurring && onChangeRecurrence
      ? [{ key: 'recurrence', label: 'Change recurrence', icon: <SyncOutlined />, onClick: () => onChangeRecurrence(plan) }]
      : []),
    ...(!plan.isTemplate && (plan.statusCode === 1 || plan.statusCode === 3)
      ? [{ key: 'details', label: 'View details', icon: <EyeOutlined />, onClick: () => navigate(`/plans/${plan.id}`) }]
      : []),
    ...(plan.statusCode !== 3
      ? [{ key: 'edit', label: 'Edit plan', icon: <EditOutlined />, onClick: () => navigate(`/plans/${plan.id}/edit`) }]
      : []),
    {
      key: 'transactions', label: 'View transactions', icon: <UnorderedListOutlined />,
      onClick: () => {
        const qs = new URLSearchParams({ planId: plan.id, ...(plan.name ? { planName: planLabel(plan) } : {}) })
        navigate(`/transactions?${qs}`)
      },
    },
  ]

  // Active and completed plans open their details; scheduled, draft and cancelled ones open the editor
  const primaryAction = actions.find((a) => a.key === 'details') ?? actions.find((a) => a.key === 'edit')

  return (
    <div style={{ width: '100%' }}>
      {/* Top row: name + status tag */}
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Typography.Link strong onClick={(e) => { e.stopPropagation(); void primaryAction?.onClick() }}>{planLabel(plan)}</Typography.Link>
          {dateRange && (
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              {dateRange}
            </Text>
          )}
        </div>
        <Tag color={STATUS_COLOR[plan.statusCode]}>{STATUS_LABEL[plan.statusCode]}</Tag>
        <RowActions actions={actions} />
      </div>
      {/* Summary row: actual / reserved / planned + bar */}
      {splitView ? (
        <div style={{ marginTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <Text style={{ fontSize: 12, color: '#3f8600', minWidth: 10 }}>↑</Text>
            {!scheduled && (
              <>
                <Text style={{ fontSize: 12, color: '#3f8600' }}>{fmt(stats.incActual)}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>actual</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>·</Text>
                <Text style={{ fontSize: 12, color: '#3f8600' }}>{fmt(stats.incReserved)}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>reserved</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>·</Text>
              </>
            )}
            <Text style={{ fontSize: 12, color: '#3f8600' }}>{fmt(stats.incPlanned)}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>planned</Text>
            {!scheduled && <SplitBar actual={stats.incActual} reserved={stats.incReserved} planned={stats.incPlanned} kind="income" />}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <Text style={{ fontSize: 12, color: '#cf1322', minWidth: 10 }}>↓</Text>
            {!scheduled && (
              <>
                <Text style={{ fontSize: 12, color: '#cf1322' }}>{fmt(-stats.expActual)}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>actual</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>·</Text>
                <Text style={{ fontSize: 12, color: '#cf1322' }}>{fmt(-stats.expReserved)}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>reserved</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>·</Text>
              </>
            )}
            <Text style={{ fontSize: 12, color: '#cf1322' }}>{fmt(-stats.expPlanned)}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>planned</Text>
            {!scheduled && <SplitBar actual={stats.expActual} reserved={stats.expReserved} planned={stats.expPlanned} kind="expense" />}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 12 }}>
          {!scheduled && (
            <>
              <Text style={{ fontSize: 12, color: amountColor(stats.actual) }}>{fmt(stats.actual)}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>actual</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>·</Text>
              <Text style={{ fontSize: 12, color: amountColor(stats.reserved) }}>{fmt(stats.reserved)}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>reserved</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>·</Text>
            </>
          )}
          <Text style={{ fontSize: 12, color: amountColor(stats.planned) }}>{fmt(stats.planned)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>planned</Text>
          {!scheduled && (
            <>
              <div style={{ width: 80, flexShrink: 0 }}>
                <Progress percent={ep.pct} size="small" status={ep.status} showInfo={false} style={{ margin: 0 }} />
              </div>
              {ep.flipped
                ? <span style={{ fontSize: 11, color: '#3f8600' }}>↑ {fmt(stats.actual)}</span>
                : <span style={{ fontSize: 11 }}>{ep.rawPct}%</span>
              }
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PlansOverviewPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const returnState = useMemo(
    () => ({ ...loadSavedState(), ...(location.state as PlansOverviewState | null) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const [messageApi, contextHolder] = message.useMessage()
  const [mode, setMode] = useState<PeriodMode>(returnState.mode ?? 'active')
  const [offset, setOffset] = useState(returnState.offset ?? 0)
  const [plans, setPlans] = useState<PlanDetailed[]>([])
  const [splitView, setSplitView] = useState(returnState.splitView ?? false)
  const [expandedTemplateIds, setExpandedTemplateIds] = useState<string[]>(returnState.expandedTemplateIds ?? [])
  const [expandedPlanIds, setExpandedPlanIds] = useState<string[] | null>(returnState.expandedPlanIds ?? null)
  const [savedDates, setSavedDates] = useState<Partial<Record<PeriodKind, string>>>(returnState.savedDates ?? {})
  const [loading, setLoading] = useState(false)
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createForm] = Form.useForm<{ name: string; intervalType: string }>()
  const [recurrencePlanId, setRecurrencePlanId] = useState<string | null>(null)
  const [activatePlan, setActivatePlan] = useState<PlanDetailed | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({})

  const [templateId, setTemplateId] = useState<string | null>(returnState.templateId ?? null)
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const { actionsFor: txActions, modals: txModals } = usePlanTxActions(() => setReloadKey((k) => k + 1))

  useEffect(() => { setVisibleCounts({}) }, [mode, templateId])

  useEffect(() => {
    const state: PlansOverviewState = { mode, templateId, offset, splitView, expandedTemplateIds, expandedPlanIds, savedDates }
    sessionStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state))
  }, [mode, templateId, offset, splitView, expandedTemplateIds, expandedPlanIds, savedDates])

  function changeExpanded(groupPlans: PlanDetailed[], keys: string | string[], defaults: string[]) {
    const groupIds = new Set(groupPlans.map((p) => p.id))
    const next = typeof keys === 'string' ? [keys] : keys
    setExpandedPlanIds([...(expandedPlanIds ?? defaults).filter((id) => !groupIds.has(id)), ...next])
  }

  async function createTemplate() {
    const values = await createForm.validateFields()
    setCreating(true)
    try {
      const res = await apiClient.post<{ id: string }>('/api/plans', {
        name: values.name.trim(),
        intervalType: values.intervalType,
        isTemplate: true,
        statusCode: 0,
      })
      setCreateOpen(false)
      navigate(`/plans/${res.data.id}/edit`, {
        state: { returnState: { mode, offset, splitView, expandedTemplateIds } },
      })
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: string } }; message?: string }
      messageApi.error(e.response?.data?.message ?? e.response?.data?.error ?? e.message ?? 'Failed to create plan template')
    } finally {
      setCreating(false)
    }
  }

  async function deleteTemplate(plan: PlanDetailed) {
    setDeletingPlanId(plan.id)
    try {
      await apiClient.delete(`/api/plans/${plan.id}`)
      setPlans((current) => current.filter((candidate) => candidate.id !== plan.id))
      messageApi.success('Plan template deleted')
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: string } }; message?: string }
      messageApi.error(e.response?.data?.message ?? e.response?.data?.error ?? e.message ?? 'Failed to delete plan template')
    } finally {
      setDeletingPlanId(null)
    }
  }

  const period = useMemo(
    () => isPeriodKind(mode) ? getPeriod(mode, offset) : null,
    [mode, offset]
  )

  function showTemplate(plan: PlanDetailed) {
    handleModeChange('template')
    setTemplateId(plan.isTemplate ? plan.id : plan.templateId ?? null)
  }

  function templateActions(plan: PlanDetailed): RowAction[] {
    return [
      ...(plan.statusCode !== 0 && plan.intervalType !== 'ONE_TIME'
        ? [{ key: 'occurrences', label: 'Show all occurrences', icon: <HistoryOutlined />, onClick: () => showTemplate(plan) }]
        : []),
      ...(plan.statusCode === 0 ? [{ key: 'activate', label: 'Activate', icon: <PlayCircleOutlined />, onClick: () => setActivatePlan(plan) }] : []),
      ...(plan.statusCode === 1 && plan.intervalType !== 'ONE_TIME'
        ? [{ key: 'recurrence', label: 'Change recurrence', icon: <SyncOutlined />, onClick: () => setRecurrencePlanId(plan.id) }]
        : []),
      {
        key: 'edit', label: 'Edit template', icon: <EditOutlined />,
        onClick: () => navigate(`/plans/${plan.id}/edit`, { state: { returnState: { mode, offset, splitView, expandedTemplateIds } } }),
      },
      {
        key: 'delete', label: 'Delete template', icon: <DeleteOutlined />, danger: true, disabled: deletingPlanId === plan.id,
        confirm: { title: 'Delete this plan template?', description: 'This action cannot be undone.', okText: 'Delete' },
        onClick: () => deleteTemplate(plan),
      },
    ]
  }
  function cycleTemplate(step: number) {
    if (templates.length === 0) return
    const index = templates.findIndex((t) => t.id === templateId)
    setTemplateId(templates[(index + step + templates.length) % templates.length].id)
  }

  // Active recurring templates the user can cycle through in template mode
  useEffect(() => {
    if (mode !== 'template') return
    let cancelled = false
    apiClient
      .get<PlanDetailed[]>('/api/plans', { params: { status: '1', isTemplate: 'true' } })
      .then((res) => {
        if (cancelled) return
        const list = res.data
          .filter((p) => p.intervalType !== 'ONE_TIME')
          .map((p) => ({ id: p.id, name: p.name ?? '(unnamed)' }))
          .sort((a, b) => a.name.localeCompare(b.name))
        setTemplates(list)
        setTemplateId((current) => (current && list.some((t) => t.id === current) ? current : list[0]?.id ?? null))
      })
      .catch(() => { if (!cancelled) setTemplates([]) })
    return () => { cancelled = true }
  }, [mode, reloadKey])

  function handleModeChange(next: PeriodMode) {
    const saved = { ...savedDates }
    if (period && isPeriodKind(mode)) saved[mode] = toLocalDateStr(period.from)
    setSavedDates(saved)

    let nextOffset = 0
    if (isPeriodKind(next)) {
      const savedDate = saved[next] ? dayjs(saved[next]) : null
      const savedOffset = savedDate ? computeOffset(next, savedDate) : 0
      if (!period) {
        nextOffset = savedOffset
      } else {
        // Prefer the remembered period if it overlaps the one being left, else the one containing its start
        const candidate = savedDate ? getPeriod(next, savedOffset) : null
        const overlaps = candidate && candidate.from <= period.to && candidate.to >= period.from
        nextOffset = overlaps ? savedOffset : computeOffset(next, dayjs(period.from))
      }
    }
    setMode(next)
    setOffset(nextOffset)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params: Record<string, string> = { detailed: 'true' }
    if (mode === 'template') {
      if (!templateId) { setPlans([]); setLoading(false); return }
      params.templateId = templateId
    } else if (mode === 'templates') {
      // no date filtering — fetch all and keep templates
    } else if (mode === 'active') {
      const today = toLocalDateStr(new Date())
      params.from = today
      params.to = today
    } else if (period) {
      params.from = toLocalDateStr(period.from)
      params.to = toLocalDateStr(period.to)
    }
    apiClient
      .get<PlanDetailed[]>('/api/plans', { params })
      .then((res) => {
        if (!cancelled) {
          if (mode === 'templates') {
            setPlans(res.data.filter((p) => p.isTemplate))
          } else {
            setPlans(res.data.filter((p) => !p.isTemplate && !(mode === 'active' && p.statusCode === 4)))
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err?.response?.data?.message ?? err?.response?.data ?? err?.message ?? 'Failed to load'
          setError(String(msg))
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [mode, period, templateId, reloadKey])

  // Groups for period view
  const groupedByStatus = useMemo(() => {
    if (mode === 'active' || mode === 'templates') return null
    const groups = mode === 'template' ? [...STATUS_GROUPS, { key: '4', label: 'Cancelled Plans', codes: [4] }] : STATUS_GROUPS
    return groups
      .map((g) => {
        const inGroup = plans.filter((p) => g.codes.includes(p.statusCode))
        // Template view: the nearest upcoming plan comes first
        if (mode === 'template' && g.key === '2') inGroup.sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))
        return { ...g, plans: inGroup }
      })
      .filter((g) => g.plans.length > 0)
  }, [mode, plans])

  const discardPlan = useCallback(async (plan: PlanDetailed) => {
    try {
      await apiClient.patch(`/api/plans/${plan.id}`, { statusCode: 4 })
      setPlans((current) => current.map((p) => p.id === plan.id ? { ...p, statusCode: 4 } : p).filter((p) => p.statusCode !== 4 || mode !== 'active'))
      messageApi.success('Plan discarded')
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: string } }; message?: string }
      messageApi.error(e.response?.data?.message ?? e.response?.data?.error ?? e.message ?? 'Failed to discard plan')
    }
  }, [mode, messageApi])

  const collapseItems = useMemo(() => (list: PlanDetailed[]) => list.map((plan) => {
    const from = period?.from
    const to = period?.to
    const stats = planStats(plan, from, to)
    return {
      key: plan.id,
      label: <PlanHeader plan={plan} stats={stats} splitView={splitView} onDiscard={discardPlan} onChangeRecurrence={(p) => setRecurrencePlanId(p.id)} onActivate={setActivatePlan} onShowOccurrences={showTemplate} />,
      children: <BudgetTable budgets={plan.budgets ?? []} directTxs={plan.transactions ?? []} scheduled={plan.statusCode === 2} from={from} to={to} planStartDate={plan.startDate} planEndDate={plan.endDate} planId={plan.id} planName={planLabel(plan)} planStatusCode={plan.statusCode} splitView={splitView} txActions={txActions} />,
    }
  }), [period, splitView, discardPlan, txActions])

  // Active plans default open
  const activeDefaultKeys = useMemo(
    () => mode === 'active' ? plans.map((p) => p.id) : [],
    [mode, plans]
  )

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="large">
      {contextHolder}
      {txModals}
      <ChangeRecurrenceModal
        planId={recurrencePlanId}
        onClose={() => setRecurrencePlanId(null)}
        onChanged={() => setReloadKey((k) => k + 1)}
      />
      <LogTransactionModal open={logOpen} onClose={() => setLogOpen(false)} onLogged={() => setReloadKey((k) => k + 1)} />
      <ActivatePlanModal
        plan={activatePlan}
        onClose={() => setActivatePlan(null)}
        onActivated={() => setReloadKey((k) => k + 1)}
      />
      <Modal
        open={createOpen}
        title="New plan template"
        okText="Create"
        confirmLoading={creating}
        onOk={createTemplate}
        onCancel={() => setCreateOpen(false)}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" initialValues={{ intervalType: 'MONTHLY' }}>
          <Form.Item name="name" label="Name" rules={[{ required: true, whitespace: true, message: 'Enter a name' }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item name="intervalType" label="Interval" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'WEEKLY', label: 'Weekly' },
                { value: 'MONTHLY', label: 'Monthly' },
                { value: 'YEARLY', label: 'Yearly' },
                { value: 'ONE_TIME', label: 'One time' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
      {/* Controls */}
      <Row justify="space-between" align="middle" wrap={false}>
        <Col>
          <Radio.Group
            value={mode}
            onChange={(e) => handleModeChange(e.target.value as PeriodMode)}
            optionType="button"
            buttonStyle="solid"
          >
            <Radio.Button value="active">Active</Radio.Button>
            <Radio.Button value="week">Week</Radio.Button>
            <Radio.Button value="month">Month</Radio.Button>
            <Radio.Button value="year">Year</Radio.Button>
            <Radio.Button value="template">Template</Radio.Button>
            <Radio.Button value="templates">Templates</Radio.Button>
          </Radio.Group>
        </Col>
        {mode === 'template' && (
          <Col>
            <Space>
              <Button icon={<LeftOutlined />} disabled={templates.length < 2} onClick={() => cycleTemplate(-1)} />
              <Text strong style={{ display: 'inline-block', minWidth: 180, textAlign: 'center', fontSize: 16 }}>
                {templates.find((t) => t.id === templateId)?.name ?? '—'}
              </Text>
              <Button icon={<RightOutlined />} disabled={templates.length < 2} onClick={() => cycleTemplate(1)} />
              <Tooltip title="Edit template">
                <Button
                  icon={<EditOutlined />}
                  disabled={!templateId}
                  onClick={() => navigate(`/plans/${templateId}/edit`, {
                    state: { returnState: { mode, templateId, offset, splitView, expandedTemplateIds } },
                  })}
                />
              </Tooltip>
            </Space>
          </Col>
        )}
        {isPeriodKind(mode) && period && (
          <Col>
            <Space>
              <Button icon={<LeftOutlined />} onClick={() => setOffset((o) => o - 1)} />
              <DatePicker
                picker={mode === 'week' ? 'week' : mode === 'month' ? 'month' : 'year'}
                value={dayjs(period.from)}
                allowClear={false}
                format={
                  mode === 'week'
                    ? (d) => `Week ${d.isoWeek()}, ${d.isoWeekYear()}`
                    : mode === 'month'
                    ? 'MMMM YYYY'
                    : 'YYYY'
                }
                onChange={(d) => { if (d) setOffset(computeOffset(mode as PeriodKind, d)) }}
                style={{ width: 200, textAlign: 'center', fontWeight: 600, fontSize: 16 }}
                variant="borderless"
              />
              <Button icon={<RightOutlined />} onClick={() => setOffset((o) => o + 1)} />
            </Space>
          </Col>
        )}
        <Col style={{ minWidth: 140, textAlign: 'right' }}>
          <Space>
            <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setLogOpen(true)}>
              Log transaction
            </Button>
            {mode === 'templates' && (
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => { createForm.resetFields(); setCreateOpen(true) }}
              >
                New template
              </Button>
            )}
            <Switch size="small" checked={splitView} onChange={setSplitView} />
            <Text type="secondary" style={{ fontSize: 12 }}>Income / Expense</Text>
          </Space>
        </Col>
      </Row>

      {loading && (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" />
        </div>
      )}

      {error && <Alert type="error" message={error} showIcon />}

      {!loading && !error && (
        <>
          {mode === 'templates' ? (
            plans.length > 0
                ? <Collapse
                  items={plans.map((plan) => {
                    const stats = planStats(plan)
                    return {
                      key: plan.id,
                      label: (
                        <div style={{ width: '100%' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Typography.Link strong style={{ flex: 1 }} onClick={(e) => { e.stopPropagation(); void templateActions(plan).find((a) => a.key === 'edit')?.onClick() }}>
                              {plan.name ?? '(unnamed)'}
                            </Typography.Link>
                            <Tag color="purple">{plan.intervalType}</Tag>
                            <Tag color={STATUS_COLOR[plan.statusCode]}>{STATUS_LABEL[plan.statusCode]}</Tag>
                            <RowActions actions={templateActions(plan)} />
                          </div>
                          {splitView ? (
                            <div style={{ marginTop: 4 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                                <Text style={{ fontSize: 12, color: '#3f8600', minWidth: 10 }}>↑</Text>
                                <Text style={{ fontSize: 12, color: '#3f8600' }}>{fmt(stats.incPlanned)}</Text>
                                <Text type="secondary" style={{ fontSize: 12 }}>planned</Text>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                                <Text style={{ fontSize: 12, color: '#cf1322', minWidth: 10 }}>↓</Text>
                                <Text style={{ fontSize: 12, color: '#cf1322' }}>{fmt(-stats.expPlanned)}</Text>
                                <Text type="secondary" style={{ fontSize: 12 }}>planned</Text>
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 12 }}>
                              <Text style={{ fontSize: 12, color: amountColor(stats.planned) }}>{fmt(stats.planned)}</Text>
                              <Text type="secondary" style={{ fontSize: 12 }}>planned</Text>
                            </div>
                          )}
                        </div>
                      ),
                      children: (
                        <div>
                          <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>Budgets</Title>
                          <BudgetTable
                            budgets={plan.budgets ?? []}
                            directTxs={plan.transactions ?? []}
                            scheduled
                            planId={plan.id}
                            planName={plan.name}
                            splitView={splitView}
                          />
                        </div>
                      ),
                    }
                  })}
                  activeKey={expandedTemplateIds}
                  onChange={(keys) => setExpandedTemplateIds(typeof keys === 'string' ? [keys] : keys)}
                />
              : <Text type="secondary">No plan templates found.</Text>
          ) : mode === 'active' ? (
            plans.length > 0
              ? <Collapse
                  styles={{ body: { padding: 0 } }}
                  items={collapseItems(plans)}
                  activeKey={expandedPlanIds ?? activeDefaultKeys}
                  onChange={(keys) => changeExpanded(plans, keys, activeDefaultKeys)}
                />
              : <Text type="secondary">No active plans found.</Text>
          ) : (
            groupedByStatus && groupedByStatus.length > 0
              ? groupedByStatus.map((group) => {
                  // Template view lists long histories, so scheduled and completed plans load in chunks
                  const paged = mode === 'template' && (group.key === '2' || group.key === '3')
                  const visible = visibleCounts[group.key] ?? INITIAL_VISIBLE
                  const shown = paged ? group.plans.slice(0, visible) : group.plans
                  return (
                    <div key={group.key}>
                      <Title level={5} style={{ marginBottom: 8 }}>{group.label}{paged ? ` (${group.plans.length})` : ''}</Title>
                      <Collapse
                        styles={{ body: { padding: 0 } }}
                        items={collapseItems(shown)}
                        activeKey={expandedPlanIds ?? []}
                        onChange={(keys) => changeExpanded(group.plans, keys, [])}
                      />
                      {paged && group.plans.length > visible && (
                        <Button
                          type="link" style={{ paddingLeft: 0 }}
                          onClick={() => setVisibleCounts((c) => ({ ...c, [group.key]: visible + LOAD_MORE_STEP }))}
                        >
                          Show {Math.min(LOAD_MORE_STEP, group.plans.length - visible)} more ({group.plans.length - visible} remaining)
                        </Button>
                      )}
                    </div>
                  )
                })
              : <Text type="secondary">{mode === 'template' ? 'No occurrences found for this template.' : 'No plans found for this period.'}</Text>
          )}

          {/* Period summary (period views only) */}
          {mode !== 'active' && mode !== 'templates' && plans.length > 0 && (() => {
            const all = plans.map((p) => planStats(p, period?.from, period?.to))
            const totalPlanned = all.reduce((s, p) => s + p.planned, 0)
            const totalActual = all.reduce((s, p) => s + p.actual, 0)
            const totalReserved = all.reduce((s, p) => s + p.reserved, 0)
            if (splitView) {
              const tIncP = all.reduce((s, p) => s + p.incPlanned, 0)
              const tExpP = all.reduce((s, p) => s + p.expPlanned, 0)
              const tIncA = all.reduce((s, p) => s + p.incActual, 0)
              const tExpA = all.reduce((s, p) => s + p.expActual, 0)
              const tIncR = all.reduce((s, p) => s + p.incReserved, 0)
              const tExpR = all.reduce((s, p) => s + p.expReserved, 0)
              return (
                <Row gutter={16} style={{ marginTop: 8 }}>
                  <Col>
                    <Statistic title="Income Planned" value={tIncP} precision={2} suffix="€"
                      styles={{ content: { color: '#3f8600' } }} />
                  </Col>
                  <Col>
                    <Statistic title="Income Actual" value={tIncA} precision={2} suffix="€"
                      styles={{ content: { color: '#3f8600' } }} />
                  </Col>
                  <Col>
                    <Statistic title="Income Reserved" value={tIncR} precision={2} suffix="€"
                      styles={{ content: { color: '#3f8600' } }} />
                  </Col>
                  <Col>
                    <Statistic title="Expense Planned" value={tExpP} precision={2} suffix="€"
                      styles={{ content: { color: '#cf1322' } }} prefix="-" />
                  </Col>
                  <Col>
                    <Statistic title="Expense Actual" value={tExpA} precision={2} suffix="€"
                      styles={{ content: { color: '#cf1322' } }} prefix="-" />
                  </Col>
                  <Col>
                    <Statistic title="Expense Reserved" value={tExpR} precision={2} suffix="€"
                      styles={{ content: { color: '#cf1322' } }} prefix="-" />
                  </Col>
                </Row>
              )
            }
            return (
              <Row gutter={16} style={{ marginTop: 8 }}>
                <Col>
                  <Statistic title="Total Planned" value={Math.abs(totalPlanned)} precision={2} suffix="€"
                    styles={{ content: { color: amountColor(totalPlanned) } }}
                    prefix={totalPlanned < 0 ? '-' : undefined} />
                </Col>
                <Col>
                  <Statistic title="Total Actual" value={Math.abs(totalActual)} precision={2} suffix="€"
                    styles={{ content: { color: amountColor(totalActual) } }}
                    prefix={totalActual < 0 ? '-' : undefined} />
                </Col>
                <Col>
                  <Statistic title="Reserved" value={Math.abs(totalReserved)} precision={2} suffix="€"
                    styles={{ content: { color: amountColor(totalReserved) } }}
                    prefix={totalReserved < 0 ? '-' : undefined} />
                </Col>
                <Col>
                  <Statistic
                    title="Δ Actual vs Planned"
                    value={Math.abs(totalActual - totalPlanned)}
                    precision={2}
                    suffix="€"
                    styles={{ content: { color: totalActual > totalPlanned ? '#cf1322' : '#3f8600' } }}
                    prefix={totalActual > totalPlanned ? '-' : '+'}
                  />
                </Col>
              </Row>
            )
          })()}
        </>
      )}
    </Space>
  )
}
