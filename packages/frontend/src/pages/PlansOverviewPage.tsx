import { useEffect, useState, useMemo } from 'react'
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
} from 'antd'
import { LeftOutlined, RightOutlined, UnorderedListOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import { useNavigate } from 'react-router-dom'
import apiClient from '../api/apiClient'

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
  fromAccount?: { type: string } | null
  toAccount?: { type: string } | null
}

type BudgetWithTx = {
  id: string
  name: string | null
  amount: string | null
  planId: string
  transactions: TxSummary[]
}

type PlanDetailed = {
  id: string
  name: string | null
  startDate: string | null
  endDate: string | null
  intervalType: string
  isTemplate: boolean
  stateCode: number
  statusCode: number
  budgets: BudgetWithTx[]
  transactions: TxSummary[]
}

// ─── Period helpers ───────────────────────────────────────────────────────────

type PeriodMode = 'active' | 'week' | 'month' | 'year'

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
function computeOffset(mode: Exclude<PeriodMode, 'active'>, picked: Dayjs): number {
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

function getPeriod(mode: Exclude<PeriodMode, 'active'>, offset: number): { from: Date; to: Date; label: string } {
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

function planLabel(plan: { name: string | null; isTemplate: boolean; intervalType: string; startDate: string | null }): string {
  const base = plan.name ?? '(unnamed)'
  if (plan.isTemplate || !plan.startDate) return base
  const d = new Date(plan.startDate)
  if (plan.intervalType === 'YEARLY') {
    return `${base} - ${d.getFullYear()}`
  }
  if (plan.intervalType === 'MONTHLY') {
    return `${base} - ${d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
  }
  if (plan.intervalType === 'WEEKLY') {
    const week = getISOWeek(d)
    return `${base} - Week ${String(week).padStart(2, '0')}.${d.getFullYear()}`
  }
  return base
}

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
  const dateStr = tx.executedOn ?? tx.plannedOn ?? computePlannedOn(tx.dueDateConfig, planStartDate)
  if (!dateStr) return true // no date — include (floating/unscheduled)
  const d = new Date(dateStr)
  return d >= from && d <= to
}

/** Compute the planned date for a transaction from its dueDateConfig and the plan's startDate */
function computePlannedOn(dueDateConfig: string | null | undefined, planStartDate: string | null | undefined): string | null {
  if (!dueDateConfig || !planStartDate) return null
  let cfg: {
    month?: number; day?: number; week?: number; weekDay?: number;
    date?: string; backwards?: boolean
  }
  try { cfg = JSON.parse(dueDateConfig) } catch { return null }
  if (!cfg) return null

  if (cfg.date) return cfg.date

  // Start from plan start date
  const d = new Date(planStartDate)
  if (isNaN(d.getTime())) return null

  if (cfg.month) {
    d.setMonth(d.getMonth() + cfg.month)
  }

  if (cfg.day !== undefined) {
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    let day = cfg.day
    if (day > daysInMonth) day = daysInMonth
    if (!cfg.backwards) {
      d.setDate(d.getDate() + day - 1)
    } else {
      // Go to start of next month, subtract day days
      d.setMonth(d.getMonth() + 1, 1)
      d.setDate(d.getDate() - day)
    }
  } else if (cfg.weekDay !== undefined) {
    // weekDay is a bitmask power-of-2: Monday=1, Tuesday=2, Wednesday=4 ...
    const targetDow = Math.round(Math.log2(cfg.weekDay)) // 0=Mon ... 6=Sun
    const firstDow = (d.getDay() + 6) % 7 // convert Sun=0 to Mon=0 system
    let offset = targetDow >= firstDow ? targetDow - firstDow : 7 - (firstDow - targetDow)
    if (cfg.week && cfg.week > 1) {
      offset += 7 * (cfg.week - 1)
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      if (d.getDate() + offset >= daysInMonth) offset -= 7
    }
    d.setDate(d.getDate() + offset)
  }

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
  let reservation = fullEnvelope + unplannedActual // how much of the full envelope is still reserved
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
  return {
    planned, actual, reserved: reservation,
    incPlanned: _plnS.inc, incActual: _actS.inc,
    incReserved: reservation > 0 ? reservation : 0,
    expPlanned: Math.abs(budgetEnvelope) + _plnS.exp, expActual: _actS.exp,
    expReserved: reservation < 0 ? Math.abs(reservation) : 0,
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

type BudgetRow = { key: string; name: string; planned: number; actual: number; reserved: number; incPlanned: number; incActual: number; incReserved: number; expPlanned: number; expActual: number; expReserved: number; pct: number; rawPct: number; status: 'success' | 'normal' | 'exception'; flipped: boolean }

function BudgetTable({ budgets, directTxs, scheduled, from, to, planStartDate, planEndDate, planId, planName, splitView }: { budgets: BudgetWithTx[]; directTxs?: TxSummary[]; scheduled?: boolean; from?: Date; to?: Date; planStartDate?: string | null; planEndDate?: string | null; planId?: string; planName?: string | null; splitView?: boolean }) {
  const navigate = useNavigate()
  const rows: BudgetRow[] = (budgets ?? []).map((b) => {
    const s = budgetStats(b, from, to, planStartDate, planEndDate)
    const ep = execProgress(s)
    return { key: b.id, name: b.name ?? '—', ...s, pct: ep.pct, rawPct: ep.rawPct, status: ep.status, flipped: ep.flipped }
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
    rows.push({ key: '__direct__', name: 'Uncategorized', planned, actual, reserved, incPlanned: dPlnS.inc, incActual: dActS.inc, incReserved: dResS.inc, expPlanned: dPlnS.exp, expActual: dActS.exp, expReserved: dResS.exp, pct: ep.pct, rawPct: ep.rawPct, status: ep.status, flipped: ep.flipped })
  }

  // totals row
  const totalPlanned = rows.reduce((s, r) => s + r.planned, 0)
  const totalActual = rows.reduce((s, r) => s + r.actual, 0)
  const totalReserved = rows.reduce((s, r) => s + r.reserved, 0)
  const totalIncPlanned = rows.reduce((s, r) => s + r.incPlanned, 0)
  const totalExpPlanned = rows.reduce((s, r) => s + r.expPlanned, 0)
  const totalIncActual = rows.reduce((s, r) => s + r.incActual, 0)
  const totalExpActual = rows.reduce((s, r) => s + r.expActual, 0)
  const totalIncReserved = rows.reduce((s, r) => s + r.incReserved, 0)
  const totalExpReserved = rows.reduce((s, r) => s + r.expReserved, 0)

  return (
    <div style={{ padding: '0 4px' }}>
      <Table<BudgetRow>
        dataSource={rows}
        pagination={false}
        size="small"
        rowKey="key"
        summary={() => (
          <Table.Summary.Row style={{ fontWeight: 600 }}>
            <Table.Summary.Cell index={0}>Total</Table.Summary.Cell>
            <Table.Summary.Cell index={1}>
              {splitView ? <SplitAmount inc={totalIncPlanned} exp={totalExpPlanned} /> : <span style={{ color: amountColor(totalPlanned) }}>{fmt(totalPlanned)}</span>}
            </Table.Summary.Cell>
            {!scheduled && (
              <>
                <Table.Summary.Cell index={2}>
                  {splitView ? <SplitAmount inc={totalIncActual} exp={totalExpActual} /> : <span style={{ color: amountColor(totalActual) }}>{fmt(totalActual)}</span>}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3}>
                  {splitView ? <SplitAmount inc={totalIncReserved} exp={totalExpReserved} /> : <span style={{ color: amountColor(totalReserved) }}>{fmt(totalReserved)}</span>}
                </Table.Summary.Cell>
              </>
            )}
            <Table.Summary.Cell index={scheduled ? 2 : 4} />
          </Table.Summary.Row>
        )}
        columns={[
          { title: 'Budget', dataIndex: 'name', key: 'name', ellipsis: true },
          {
            title: 'Planned',
            dataIndex: 'planned',
            key: 'planned',
            align: 'right',
            width: 110,
            render: (_v: number, row: BudgetRow) => splitView
              ? <SplitAmount inc={row.incPlanned} exp={row.expPlanned} />
              : <span style={{ color: amountColor(row.planned) }}>{fmt(row.planned)}</span>,
          },
          ...(!scheduled ? [
            {
              title: 'Actual',
              dataIndex: 'actual',
              key: 'actual',
              align: 'right' as const,
              width: 110,
              render: (_v: number, row: BudgetRow) => splitView
                ? <SplitAmount inc={row.incActual} exp={row.expActual} />
                : <span style={{ color: amountColor(row.actual) }}>{fmt(row.actual)}</span>,
            },
            {
              title: 'Reserved',
              dataIndex: 'reserved',
              key: 'reserved',
              align: 'right' as const,
              width: 110,
              render: (_v: number, row: BudgetRow) => splitView
                ? <SplitAmount inc={row.incReserved} exp={row.expReserved} />
                : <span style={{ color: amountColor(row.reserved) }}>{fmt(row.reserved)}</span>,
            },
          ] : []),
          {
            title: 'Execution',
            key: 'exec',
            width: 150,
            render: (_: unknown, row: BudgetRow) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1 }}>
                  <Progress percent={row.pct} size="small" status={row.status} showInfo={false} />
                </div>
                {row.flipped
                  ? <span style={{ fontSize: 12, minWidth: 36, textAlign: 'right', color: '#3f8600' }}>↑ {fmt(row.actual)}</span>
                  : <span style={{ fontSize: 12, minWidth: 36, textAlign: 'right' }}>{row.rawPct}%</span>
                }
              </div>
            ),
          },
          {
            title: '',
            key: 'actions',
            width: 40,
            render: (_: unknown, row: BudgetRow) => {
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
              const qs = new URLSearchParams({ budgetId: budget.id, budgetName: row.name })
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

function PlanHeader({ plan, stats, splitView }: { plan: PlanDetailed; stats: BudgetStats; splitView?: boolean }) {
  const navigate = useNavigate()
  const dateRange = [plan.startDate, plan.endDate]
    .map((d) => (d ? new Date(d).toLocaleDateString('sk-SK') : ''))
    .filter(Boolean)
    .join(' – ')

  const scheduled = plan.statusCode === 2
  const ep = execProgress(stats)

  return (
    <div style={{ width: '100%' }}>
      {/* Top row: name + status tag */}
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text strong>{planLabel(plan)}</Text>
          {dateRange && (
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              {dateRange}
            </Text>
          )}
        </div>
        <Tag color={STATUS_COLOR[plan.statusCode]}>{STATUS_LABEL[plan.statusCode]}</Tag>
        <Tooltip title="View transactions">
          <Button
            size="small" type="text" icon={<UnorderedListOutlined />}
            onClick={(e) => {
              e.stopPropagation()
              const qs = new URLSearchParams({ planId: plan.id, ...(plan.name ? { planName: planLabel(plan) } : {}) })
              navigate(`/transactions?${qs}`)
            }}
          />
        </Tooltip>
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
  const [mode, setMode] = useState<PeriodMode>('active')
  const [offset, setOffset] = useState(0)
  const [plans, setPlans] = useState<PlanDetailed[]>([])
  const [splitView, setSplitView] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const period = useMemo(
    () => mode !== 'active' ? getPeriod(mode, offset) : null,
    [mode, offset]
  )

  function handleModeChange(m: PeriodMode) {
    setMode(m)
    setOffset(0)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params: Record<string, string> = { detailed: 'true' }
    if (mode === 'active') {
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
        if (!cancelled) setPlans(res.data.filter((p) => !p.isTemplate))
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err?.response?.data?.message ?? err?.response?.data ?? err?.message ?? 'Failed to load'
          setError(String(msg))
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [mode, period])

  // Groups for period view
  const groupedByStatus = useMemo(() => {
    if (mode === 'active') return null
    return STATUS_GROUPS
      .map((g) => ({ ...g, plans: plans.filter((p) => g.codes.includes(p.statusCode)) }))
      .filter((g) => g.plans.length > 0)
  }, [mode, plans])

  const collapseItems = useMemo(() => (list: PlanDetailed[]) => list.map((plan) => {
    const from = period?.from
    const to = period?.to
    const stats = planStats(plan, from, to)
    return {
      key: plan.id,
      label: <PlanHeader plan={plan} stats={stats} splitView={splitView} />,
      children: <BudgetTable budgets={plan.budgets ?? []} directTxs={plan.transactions ?? []} scheduled={plan.statusCode === 2} from={from} to={to} planStartDate={plan.startDate} planEndDate={plan.endDate} planId={plan.id} planName={planLabel(plan)} splitView={splitView} />,
    }
  }), [period, splitView])

  // Active plans default open
  const activeDefaultKeys = useMemo(
    () => mode === 'active' ? plans.map((p) => p.id) : [],
    [mode, plans]
  )

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="large">
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
          </Radio.Group>
        </Col>
        {mode !== 'active' && period && (
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
                onChange={(d) => { if (d) setOffset(computeOffset(mode, d)) }}
                style={{ width: 200, textAlign: 'center', fontWeight: 600, fontSize: 16 }}
                variant="borderless"
              />
              <Button icon={<RightOutlined />} onClick={() => setOffset((o) => o + 1)} />
            </Space>
          </Col>
        )}
        <Col style={{ minWidth: 140, textAlign: 'right' }}>
          <Space>
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
          {mode === 'active' ? (
            plans.length > 0
              ? <Collapse items={collapseItems(plans)} defaultActiveKey={activeDefaultKeys} />
              : <Text type="secondary">No active plans found.</Text>
          ) : (
            groupedByStatus && groupedByStatus.length > 0
              ? groupedByStatus.map((group) => (
                  <div key={group.key}>
                    <Title level={5} style={{ marginBottom: 8 }}>{group.label}</Title>
                    <Collapse items={collapseItems(group.plans)} />
                  </div>
                ))
              : <Text type="secondary">No plans found for this period.</Text>
          )}

          {/* Period summary (period views only) */}
          {mode !== 'active' && plans.length > 0 && (() => {
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
