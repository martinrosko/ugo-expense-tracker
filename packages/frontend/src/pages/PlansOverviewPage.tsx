import { useEffect, useState, useMemo } from 'react'
import {
  Typography,
  Space,
  Button,
  Radio,
  Tabs,
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
} from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import apiClient from '../api/apiClient'

dayjs.extend(isoWeek)

const { Title, Text } = Typography

// ─── Types ───────────────────────────────────────────────────────────────────

type TxSummary = {
  id: string
  name?: string | null
  amount: string | null
  plannedAmount: string | null
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

type PeriodMode = 'week' | 'month' | 'year'

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
function computeOffset(mode: PeriodMode, picked: Dayjs): number {
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

function getPeriod(mode: PeriodMode, offset: number): { from: Date; to: Date; label: string } {
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

function parse(v: string | null | undefined): number {
  return v ? parseFloat(v) || 0 : 0
}

function fmt(v: number): string {
  return (v < 0 ? '-' : '') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

function amountColor(v: number) {
  return v < 0 ? '#cf1322' : v > 0 ? '#3f8600' : undefined
}

type BudgetStats = { planned: number; actual: number; reserved: number }

function budgetStats(b: BudgetWithTx): BudgetStats {
  const txs = (b.transactions ?? []).filter((t) => t.type === 'TRANSACTION')
  const actual = txs.filter((t) => t.executedOn !== null).reduce((s, t) => s + signedAmount(t, t.amount), 0)
  const reserved = txs.filter((t) => t.executedOn === null).reduce((s, t) => s + signedAmount(t, t.plannedAmount), 0)
  const txPlannedSum = txs.reduce((s, t) => s + signedAmount(t, t.plannedAmount), 0)
  // Budget envelope is always an expense allocation (negative); transactions add their own signed amounts on top
  const budgetEnvelope = b.amount ? -Math.abs(parse(b.amount)) : 0
  return { planned: budgetEnvelope + txPlannedSum, actual, reserved }
}

function planStats(plan: PlanDetailed): BudgetStats {
  const bs = (plan.budgets ?? []).map(budgetStats)
  const directTxs = (plan.transactions ?? []).filter((t) => t.type === 'TRANSACTION')
  const directActual = directTxs.filter((t) => t.executedOn !== null).reduce((s, t) => s + signedAmount(t, t.amount), 0)
  const directReserved = directTxs.filter((t) => t.executedOn === null).reduce((s, t) => s + signedAmount(t, t.plannedAmount), 0)
  const directPlanned = directTxs.reduce((s, t) => s + signedAmount(t, t.plannedAmount), 0)
  return {
    planned: bs.reduce((s, b) => s + b.planned, 0) + directPlanned,
    actual: bs.reduce((s, b) => s + b.actual, 0) + directActual,
    reserved: bs.reduce((s, b) => s + b.reserved, 0) + directReserved,
  }
}

function execProgress(stats: BudgetStats): { pct: number; rawPct: number; status: 'success' | 'normal' | 'exception'; flipped: boolean } {
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

function BudgetTable({ budgets, directTxs, scheduled }: { budgets: BudgetWithTx[]; directTxs?: TxSummary[]; scheduled?: boolean }) {
  const rows = (budgets ?? []).map((b) => {
    const s = budgetStats(b)
    const ep = execProgress(s)
    return { key: b.id, name: b.name ?? '—', ...s, pct: ep.pct, rawPct: ep.rawPct, status: ep.status, flipped: ep.flipped }
  })

  // Add uncategorized row if there are direct plan transactions
  const filteredDirect = (directTxs ?? []).filter((t) => t.type === 'TRANSACTION')
  if (filteredDirect.length > 0) {
    const actual = filteredDirect.filter((t) => t.executedOn !== null).reduce((s, t) => s + signedAmount(t, t.amount), 0)
    const reserved = filteredDirect.filter((t) => t.executedOn === null).reduce((s, t) => s + signedAmount(t, t.plannedAmount), 0)
    const planned = filteredDirect.reduce((s, t) => s + signedAmount(t, t.plannedAmount), 0)
    const ep = execProgress({ planned, actual, reserved })
    rows.push({ key: '__direct__', name: 'Uncategorized', planned, actual, reserved, pct: ep.pct, rawPct: ep.rawPct, status: ep.status, flipped: ep.flipped })
  }

  // totals row
  const totalPlanned = rows.reduce((s, r) => s + r.planned, 0)
  const totalActual = rows.reduce((s, r) => s + r.actual, 0)
  const totalReserved = rows.reduce((s, r) => s + r.reserved, 0)

  return (
    <div style={{ padding: '0 4px' }}>
      <Table
        dataSource={rows}
        pagination={false}
        size="small"
        rowKey="key"
        summary={() => (
          <Table.Summary.Row style={{ fontWeight: 600 }}>
            <Table.Summary.Cell index={0}>Total</Table.Summary.Cell>
            <Table.Summary.Cell index={1}>
              <span style={{ color: amountColor(totalPlanned) }}>{fmt(totalPlanned)}</span>
            </Table.Summary.Cell>
            {!scheduled && (
              <>
                <Table.Summary.Cell index={2}>
                  <span style={{ color: amountColor(totalActual) }}>{fmt(totalActual)}</span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3}>
                  <span style={{ color: amountColor(totalReserved) }}>{fmt(totalReserved)}</span>
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
            render: (v: number) => <span style={{ color: amountColor(v) }}>{fmt(v)}</span>,
          },
          ...(!scheduled ? [
            {
              title: 'Actual',
              dataIndex: 'actual',
              key: 'actual',
              align: 'right' as const,
              width: 110,
              render: (v: number) => <span style={{ color: amountColor(v) }}>{fmt(v)}</span>,
            },
            {
              title: 'Reserved',
              dataIndex: 'reserved',
              key: 'reserved',
              align: 'right' as const,
              width: 110,
              render: (v: number) => <span style={{ color: amountColor(v) }}>{fmt(v)}</span>,
            },
          ] : []),
          {
            title: 'Execution',
            key: 'exec',
            width: 150,
            render: (_: unknown, row: { pct: number; rawPct: number; status: 'success' | 'normal' | 'exception'; flipped: boolean; actual: number }) => (
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
        ]}
      />
    </div>
  )
}

function PlanHeader({ plan, stats }: { plan: PlanDetailed; stats: BudgetStats }) {
  const dateRange = [plan.startDate, plan.endDate]
    .map((d) => (d ? new Date(d).toLocaleDateString('sk-SK') : ''))
    .filter(Boolean)
    .join(' – ')

  return (
    <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text strong>{plan.name ?? '(unnamed)'}</Text>
        {dateRange && (
          <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
            {dateRange}
          </Text>
        )}
      </div>
      <Tag color={STATUS_COLOR[plan.statusCode]}>{STATUS_LABEL[plan.statusCode]}</Tag>
      <div style={{ textAlign: 'right' }}>
        {plan.statusCode === 2
          ? <Text strong style={{ color: amountColor(stats.planned) }}>{fmt(stats.planned)}</Text>
          : <>
              <Text strong style={{ color: amountColor(stats.actual) }}>{fmt(stats.actual)}</Text>
              <Text type="secondary" style={{ fontSize: 12, marginLeft: 4 }}>/ {fmt(stats.planned)}</Text>
            </>
        }
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PlansOverviewPage() {
  const [mode, setMode] = useState<PeriodMode>('month')
  const [offset, setOffset] = useState(0)
  const [statusTab, setStatusTab] = useState<string>('all')
  const [plans, setPlans] = useState<PlanDetailed[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const period = useMemo(() => getPeriod(mode, offset), [mode, offset])

  // Reset offset when switching mode so we always start at current period
  function handleModeChange(m: PeriodMode) {
    setMode(m)
    setOffset(0)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    apiClient
      .get<PlanDetailed[]>('/api/plans', {
        params: {
          from: toLocalDateStr(period.from),
          to: toLocalDateStr(period.to),
          detailed: 'true',
        },
      })
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
  }, [period])

  // Filter by status tab
  const filteredPlans = useMemo(() => {
    if (statusTab === 'all') return plans
    const code = parseInt(statusTab, 10)
    return plans.filter((p) => p.statusCode === code)
  }, [plans, statusTab])

  // Group plans for "All" tab
  const groupedForAll = useMemo(() => {
    if (statusTab !== 'all') return null
    return STATUS_GROUPS.map((g) => ({
      ...g,
      plans: plans.filter((p) => g.codes.includes(p.statusCode)),
    })).filter((g) => g.plans.length > 0)
  }, [plans, statusTab])

  const collapseItems = useMemo(() => (list: PlanDetailed[]) => list.map((plan) => {
    const stats = planStats(plan)
    return {
      key: plan.id,
      label: <PlanHeader plan={plan} stats={stats} />,
      children: <BudgetTable budgets={plan.budgets ?? []} directTxs={plan.transactions ?? []} scheduled={plan.statusCode === 2} />,
    }
  }), [])

  const tabItems = useMemo(() => [
    { key: 'all', label: 'All' },
    { key: '1', label: 'Active' },
    { key: '2', label: 'Scheduled' },
    { key: '3', label: 'Completed' },
    { key: '0', label: 'Draft' },
  ], [])

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="large">
      {/* Period controls */}
      <Row justify="space-between" align="middle" wrap={false}>
        <Col>
          <Radio.Group
            value={mode}
            onChange={(e) => handleModeChange(e.target.value as PeriodMode)}
            optionType="button"
            buttonStyle="solid"
          >
            <Radio.Button value="week">Week</Radio.Button>
            <Radio.Button value="month">Month</Radio.Button>
            <Radio.Button value="year">Year</Radio.Button>
          </Radio.Group>
        </Col>
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
        <Col style={{ minWidth: 140 }} />
      </Row>

      {/* Status filter tabs */}
      <Tabs
        activeKey={statusTab}
        onChange={setStatusTab}
        items={tabItems}
        style={{ marginBottom: 0 }}
      />

      {/* Content */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" />
        </div>
      )}

      {error && <Alert type="error" message={error} showIcon />}

      {!loading && !error && (
        <>
          {statusTab === 'all' ? (
            // Grouped view
            groupedForAll && groupedForAll.length > 0 ? (
              groupedForAll.map((group) => (
                <div key={group.key}>
                  <Title level={5} style={{ marginBottom: 8 }}>
                    {group.label}
                  </Title>
                  <Collapse items={collapseItems(group.plans)} />
                </div>
              ))
            ) : (
              <Text type="secondary">No plans found for this period.</Text>
            )
          ) : filteredPlans.length > 0 ? (
            <Collapse items={collapseItems(filteredPlans)} />
          ) : (
            <Text type="secondary">No plans found for this period.</Text>
          )}

          {/* Period summary */}
          {plans.length > 0 && (() => {
            const all = plans.map(planStats)
            const totalPlanned = all.reduce((s, p) => s + p.planned, 0)
            const totalActual = all.reduce((s, p) => s + p.actual, 0)
            const totalReserved = all.reduce((s, p) => s + p.reserved, 0)
            return (
              <Row gutter={16} style={{ marginTop: 8 }}>
                <Col>
                  <Statistic
                    title="Total Planned"
                    value={Math.abs(totalPlanned)}
                    precision={2}
                    suffix="€"
                    styles={{ content: { color: amountColor(totalPlanned) } }}
                    prefix={totalPlanned < 0 ? '-' : undefined}
                  />
                </Col>
                <Col>
                  <Statistic
                    title="Total Actual"
                    value={Math.abs(totalActual)}
                    precision={2}
                    suffix="€"
                    styles={{ content: { color: amountColor(totalActual) } }}
                    prefix={totalActual < 0 ? '-' : undefined}
                  />
                </Col>
                <Col>
                  <Statistic
                    title="Reserved"
                    value={Math.abs(totalReserved)}
                    precision={2}
                    suffix="€"
                    styles={{ content: { color: amountColor(totalReserved) } }}
                    prefix={totalReserved < 0 ? '-' : undefined}
                  />
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
