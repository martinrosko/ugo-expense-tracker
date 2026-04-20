import { useEffect, useState, useMemo, useRef } from 'react'
import {
  Typography,
  Space,
  Button,
  Radio,
  Table,
  Tag,
  Spin,
  Alert,
  Row,
  Col,
  DatePicker,
  Select,
  InputNumber,
  TreeSelect,
  Segmented,
  Checkbox,
} from 'antd'
import { LeftOutlined, RightOutlined, UnorderedListOutlined, LineChartOutlined } from '@ant-design/icons'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  ReferenceLine,
} from 'recharts'
import dayjs, { type Dayjs } from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import { useSearchParams } from 'react-router-dom'
import apiClient from '../api/apiClient'

dayjs.extend(isoWeek)

const { Title, Text } = Typography
const { RangePicker } = DatePicker

// ─── Types ───────────────────────────────────────────────────────────────────

type Account = { id: string; name: string; type: string }
type BudgetOption = { id: string; name: string | null }
type PlanOption = { id: string; name: string | null; isTemplate: boolean; intervalType: string; startDate: string | null; templateId: string | null; statusCode: number }

type Transaction = {
  id: string
  name: string | null
  amount: string | null
  plannedAmount: string | null
  executedOn: string | null
  plannedOn: string | null
  type: string
  fromAccount?: Account | null
  toAccount?: Account | null
  plan?: { id: string; name: string | null } | null
  budget?: { id: string; name: string | null } | null
  tags?: { tag: { id: string; name: string; color?: string | null } }[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type PeriodMode = 'day' | 'week' | 'month' | 'custom' | 'all'

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function planLabel(plan: { name: string | null; isTemplate: boolean; intervalType: string; startDate: string | null }): string {
  const base = plan.name ?? '(unnamed)'
  if (plan.isTemplate || !plan.startDate) return base
  const d = new Date(plan.startDate)
  if (plan.intervalType === 'YEARLY') return `${base} - ${d.getFullYear()}`
  if (plan.intervalType === 'MONTHLY') return `${base} - ${d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
  if (plan.intervalType === 'WEEKLY') return `${base} - Week ${String(getISOWeek(d)).padStart(2, '0')}.${d.getFullYear()}`
  return base
}

function getPeriod(mode: Exclude<PeriodMode, 'all' | 'custom'>, offset: number): { from: Date; to: Date; label: string } {
  const now = new Date()
  if (mode === 'day') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
    return { from: d, to: d, label: d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) }
  }
  if (mode === 'week') {
    const dow = (now.getDay() + 6) % 7
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + offset * 7)
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
    return { from: monday, to: sunday, label: `Week ${getISOWeek(monday)}, ${monday.getFullYear()}` }
  }
  const base = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const from = new Date(base.getFullYear(), base.getMonth(), 1)
  const to = new Date(base.getFullYear(), base.getMonth() + 1, 0)
  return { from, to, label: from.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }
}

function computeOffset(mode: Exclude<PeriodMode, 'all' | 'custom'>, picked: Dayjs): number {
  const now = new Date()
  if (mode === 'day') return Math.round(picked.startOf('day').diff(dayjs().startOf('day'), 'day'))
  if (mode === 'month') return (picked.year() - now.getFullYear()) * 12 + (picked.month() - now.getMonth())
  const dow = (now.getDay() + 6) % 7
  const currentMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow)
  const pickedMonday = picked.isoWeekday(1).startOf('day').toDate()
  return Math.round((pickedMonday.getTime() - currentMonday.getTime()) / (7 * 86400000))
}

function fmt(v: string | number | null | undefined): string {
  const n = typeof v === 'number' ? v : v ? parseFloat(v) : 0
  return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

const ACCOUNT_TYPE_ICON: Record<string, React.ReactNode> = {
  BANK: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}>
      <path d="M2 10h20v2H2zm2 4h2v6H4zm4 0h2v6H8zm4 0h2v6h-2zm4 0h2v6h-2zm2-10L12 1 2 4v2h20V4z" />
    </svg>
  ),
  CASH: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}>
      <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zm-8-2a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0-6a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" />
    </svg>
  ),
  INVESTMENT: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}>
      <path d="M3.5 18.5l4-4 4 4 4-5 4 5H3.5zM21 6.5h-3v-2h3v2zm-5 0h-3v-2h3v2zM5 6.5H2v-2h3v2z" />
      <path d="M2 8h20v2H2z" />
    </svg>
  ),
}

const ASSET_TYPES = new Set(['CASH', 'BANK', 'INVESTMENT'])

function txKind(tx: Transaction): 'expense' | 'income' | 'transfer' {
  const from = tx.fromAccount?.type ?? ''
  const to = tx.toAccount?.type ?? ''
  const fromAsset = ASSET_TYPES.has(from)
  const toAsset = ASSET_TYPES.has(to)
  if (fromAsset && toAsset) return 'transfer'
  if (toAsset && !fromAsset) return 'income'
  return 'expense'
}

function txAmountColor(tx: Transaction) {
  const kind = txKind(tx)
  if (kind === 'expense') return '#cf1322'
  if (kind === 'income') return '#3f8600'
  return undefined
}

// ─── Chart helpers ────────────────────────────────────────────────────────────

type ChartGroup = 'none' | 'day' | 'week' | 'month'
type ChartPoint = { label: string; income: number; expense: number; total: number }

function buildChartData(txs: Transaction[], groupBy: ChartGroup): ChartPoint[] {
  if (groupBy === 'none') {
    return [...txs]
      .sort((a, b) => (a.executedOn ?? '').localeCompare(b.executedOn ?? ''))
      .map((tx) => {
        const v = tx.amount ? Math.abs(parseFloat(tx.amount)) : 0
        const kind = txKind(tx)
        const inc = kind === 'income' ? v : 0
        const exp = kind === 'expense' ? v : 0
        return {
          label: tx.name ?? new Date(tx.executedOn ?? '').toLocaleDateString('sk-SK'),
          income: round2(inc),
          expense: round2(exp),
          total: round2(inc - exp),
        }
      })
  }

  const buckets = new Map<string, { inc: number; exp: number }>()
  const bucketLabel = (date: string) => {
    const d = dayjs(date)
    if (groupBy === 'day') return d.format('D MMM')
    if (groupBy === 'week') return `W${d.isoWeek()}`
    return d.format('MMM YYYY')
  }
  const bucketKey = (date: string) => {
    const d = dayjs(date)
    if (groupBy === 'day') return d.format('YYYY-MM-DD')
    if (groupBy === 'week') return `${d.isoWeekYear()}-W${String(d.isoWeek()).padStart(2, '0')}`
    return d.format('YYYY-MM')
  }

  for (const tx of txs) {
    if (!tx.executedOn) continue
    const key = bucketKey(tx.executedOn)
    const kind = txKind(tx)
    const v = tx.amount ? Math.abs(parseFloat(tx.amount)) : 0
    const existing = buckets.get(key) ?? { inc: 0, exp: 0 }
    if (kind === 'income') existing.inc += v
    else if (kind === 'expense') existing.exp += v
    buckets.set(key, existing)
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, { inc, exp }]) => {
      let dateForLabel: string
      if (groupBy === 'week') {
        const [yr, w] = key.split('-W').map(Number)
        const jan4 = dayjs(`${yr}-01-04`)
        const jan4Mon = jan4.isoWeekday(1)
        dateForLabel = jan4Mon.add((w - 1) * 7, 'day').format('YYYY-MM-DD')
      } else if (groupBy === 'month') {
        dateForLabel = `${key}-01`
      } else {
        dateForLabel = key
      }
      const label = bucketLabel(dateForLabel)
      return { label, income: round2(inc), expense: round2(exp), total: round2(inc - exp) }
    })
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TransactionsPage() {
  const [searchParams] = useSearchParams()
  // URL context — sets initial filter state and display title
  const ctxPlanId = searchParams.get('planId') ?? undefined
  const ctxBudgetId = searchParams.get('budgetId') ?? undefined
  const ctxPlanName = searchParams.get('planName') ?? undefined
  const ctxBudgetName = searchParams.get('budgetName') ?? undefined

  // Period state
  const [mode, setMode] = useState<PeriodMode>('month')
  const [offset, setOffset] = useState(0)
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null)

  // Filter state (initialized from URL context)
  const [filterPlanId, setFilterPlanId] = useState<string | undefined>(ctxPlanId)
  const [filterBudgetId, setFilterBudgetId] = useState<string | undefined>(ctxBudgetId)
  const [filterAccountId, setFilterAccountId] = useState<string | undefined>()
  const [minAmount, setMinAmount] = useState<number | null>(null)
  const [maxAmount, setMaxAmount] = useState<number | null>(null)

  // Reference data
  const [accounts, setAccounts] = useState<Account[]>([])
  const [allPlans, setAllPlans] = useState<PlanOption[]>([])
  const [budgetOptions, setBudgetOptions] = useState<BudgetOption[]>([])

  // Transactions
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // View mode: list or chart
  const [viewMode, setViewMode] = useState<'list' | 'chart'>('list')
  const [chartGroup, setChartGroup] = useState<ChartGroup>('day')
  const [chartLines, setChartLines] = useState<string[]>(['income', 'expense', 'total'])

  // Derived period
  const period = useMemo(() => {
    if (mode === 'all' || mode === 'custom') return null
    return getPeriod(mode, offset)
  }, [mode, offset])

  function handleModeChange(m: PeriodMode) {
    setMode(m)
    setOffset(0)
  }

  // Fetch reference data once
  useEffect(() => {
    apiClient.get<Account[]>('/api/accounts').then((r) => setAccounts(r.data)).catch(() => {})
    if (!ctxBudgetId) {
      apiClient.get<PlanOption[]>('/api/plans').then((r) => setAllPlans(r.data)).catch(() => {})
    }
  }, [ctxBudgetId])

  // Don't clear filterBudgetId on initial plan effect run (preserves ctxBudgetId)
  const initialPlanFetch = useRef(true)

  // Build TreeSelect data: templates sorted by interval→name, instances (active/completed) under each template
  const planTreeData = useMemo(() => {
    const INTERVAL_ORDER: Record<string, number> = { YEARLY: 0, MONTHLY: 1, WEEKLY: 2, ONE_TIME: 3 }
    const intervalSort = (a: PlanOption, b: PlanOption) => {
      const ia = INTERVAL_ORDER[a.intervalType] ?? 9
      const ib = INTERVAL_ORDER[b.intervalType] ?? 9
      if (ia !== ib) return ia - ib
      return (a.name ?? '').localeCompare(b.name ?? '')
    }

    const templates = allPlans.filter((p) => p.isTemplate).sort(intervalSort)

    const instances = allPlans.filter(
      (p) => !p.isTemplate && (p.statusCode === 1 || p.statusCode === 3)
    )

    const nodes = templates.map((tpl) => {
      const children = instances
        .filter((p) => p.templateId === tpl.id)
        .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))
        .map((p) => ({ value: p.id, title: planLabel(p) }))
      return { value: tpl.id, title: planLabel(tpl), children }
    })

    // Standalone active/completed plans (no templateId, not a template)
    const standalone = instances
      .filter((p) => !p.templateId)
      .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))
      .map((p) => ({ value: p.id, title: planLabel(p), children: [] }))

    return [...nodes, ...standalone]
  }, [allPlans])

  function handlePlanSelect(planId: string | undefined) {
    setFilterPlanId(planId)
    setFilterBudgetId(undefined)
    if (!planId) return
    const plan = allPlans.find((p) => p.id === planId)
    if (!plan || plan.isTemplate || !plan.startDate) return
    const d = dayjs(plan.startDate)
    const now = dayjs()
    if (plan.intervalType === 'MONTHLY') {
      setMode('month')
      setOffset((d.year() - now.year()) * 12 + (d.month() - now.month()))
    } else if (plan.intervalType === 'WEEKLY') {
      setMode('week')
      const dow = (now.day() + 6) % 7
      const currentMonday = now.subtract(dow, 'day').startOf('day')
      const planMonday = d.isoWeekday(1).startOf('day')
      setOffset(Math.round(planMonday.diff(currentMonday, 'day') / 7))
    } else if (plan.intervalType === 'YEARLY') {
      setMode('custom')
      setCustomRange([d.startOf('year'), d.endOf('year')])
    }
  }

  const accountFilterData = useMemo(() => {
    const ACCOUNT_TYPE: Record<string, number> = { BANK: 0, CASH: 1, INVESTMENT: 2, PARTNER: 100 }
    const accountTypeSort = (a: Account, b: Account) => {
      const ia = ACCOUNT_TYPE[a.type] ?? 1000;
      const ib = ACCOUNT_TYPE[b.type] ?? 1000;
      if (ia !== ib) {
        return ia - ib;
      }
      return (a.name ?? '').localeCompare(b.name ?? '')
    }

    return accounts.sort(accountTypeSort);
  }, [accounts]);

  // Fetch budget options when plan filter changes
  useEffect(() => {
    if (!filterPlanId) {
      setBudgetOptions([])
      if (!initialPlanFetch.current) setFilterBudgetId(undefined)
      initialPlanFetch.current = false
      return
    }
    apiClient
      .get<BudgetOption[]>('/api/budgets', { params: { planId: filterPlanId } })
      .then((res) => setBudgetOptions(res.data))
      .catch(() => setBudgetOptions([]))
    initialPlanFetch.current = false
  }, [filterPlanId])

  // budgetId takes precedence — no need to also send planId
  const apiPlanId = filterBudgetId ? undefined : filterPlanId
  const apiBudgetId = filterBudgetId
  const customFrom = customRange?.[0]?.toDate()
  const customTo = customRange?.[1]?.toDate()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params: Record<string, string> = { executed: 'true' }
    if (apiPlanId) params.planId = apiPlanId
    if (apiBudgetId) params.budgetId = apiBudgetId
    if (filterAccountId) params.accountId = filterAccountId
    if (mode === 'custom' && customFrom && customTo) {
      params.from = toLocalDateStr(customFrom)
      params.to = toLocalDateStr(customTo)
    } else if (period) {
      params.from = toLocalDateStr(period.from)
      params.to = toLocalDateStr(period.to)
    }
    apiClient
      .get<Transaction[]>('/api/transactions', { params })
      .then((res) => { if (!cancelled) setTransactions(res.data) })
      .catch((err) => {
        if (!cancelled) {
          const msg = err?.response?.data?.message ?? err?.response?.data ?? err?.message ?? 'Failed to load'
          setError(String(msg))
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [mode, period, customFrom, customTo, apiPlanId, apiBudgetId, filterAccountId])

  // Client-side amount filter
  const filteredTxs = useMemo(() => {
    if (minAmount === null && maxAmount === null) return transactions
    return transactions.filter((tx) => {
      const amt = tx.amount ? parseFloat(tx.amount) : 0
      if (minAmount !== null && amt < minAmount) return false
      if (maxAmount !== null && amt > maxAmount) return false
      return true
    })
  }, [transactions, minAmount, maxAmount])

  const columns = useMemo(() => [
    {
      title: 'Date',
      dataIndex: 'executedOn',
      key: 'executedOn',
      width: 110,
      render: (v: string | null) => v ? new Date(v).toLocaleDateString('sk-SK') : '—',
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (v: string | null) => v ?? <Text type="secondary">(unnamed)</Text>,
    },
    {
      title: 'From',
      key: 'from',
      ellipsis: true,
      width: 140,
      render: (_: unknown, row: Transaction) =>
        row.fromAccount ? <Text>{row.fromAccount.name}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: 'To',
      key: 'to',
      ellipsis: true,
      width: 140,
      render: (_: unknown, row: Transaction) =>
        row.toAccount ? <Text>{row.toAccount.name}</Text> : <Text type="secondary">—</Text>,
    },
    ...(!apiBudgetId ? [{
      title: apiPlanId ? 'Budget' : 'Plan / Budget',
      key: 'scope',
      ellipsis: true,
      width: 180,
      render: (_: unknown, row: Transaction) => (
        <Space size={4}>
          {!apiPlanId && row.plan?.name && <Tag style={{ margin: 0 }}>{row.plan.name}</Tag>}
          {row.budget?.name && <Tag color="blue" style={{ margin: 0 }}>{row.budget.name}</Tag>}
        </Space>
      ),
    }] : []),
    {
      title: 'Amount',
      key: 'amount',
      width: 120,
      align: 'right' as const,
      render: (_: unknown, row: Transaction) => (
        <span style={{ color: txAmountColor(row), fontWeight: 600 }}>{fmt(row.amount)}</span>
      ),
    },
    {
      title: 'Tags',
      key: 'tags',
      width: 160,
      render: (_: unknown, row: Transaction) => (
        <Space size={2} wrap>
          {(row.tags ?? []).map((t) => (
            <Tag key={t.tag.id} color={t.tag.color ?? undefined} style={{ margin: 0 }}>{t.tag.name}</Tag>
          ))}
        </Space>
      ),
    },
  ], [apiPlanId, apiBudgetId])

  const contextTitle = ctxBudgetName ? `Budget: ${ctxBudgetName}` : ctxPlanName ? `Plan: ${ctxPlanName}` : null
  const showPlanBudgetFilters = !ctxBudgetId

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {/* Header */}
      <Row justify="space-between" align="middle">
        <Col>
          <Title level={4} style={{ margin: 0 }}>Transactions</Title>
          {contextTitle && <Text type="secondary">{contextTitle}</Text>}
        </Col>
        <Col>
          <Segmented
            value={viewMode}
            onChange={(v) => setViewMode(v as 'list' | 'chart')}
            options={[
              { value: 'list', icon: <UnorderedListOutlined /> },
              { value: 'chart', icon: <LineChartOutlined /> },
            ]}
          />
        </Col>
      </Row>

      {/* Period row */}
      <Row align="middle" gutter={[8, 8]}>
        <Col>
          <Radio.Group
            value={mode}
            onChange={(e) => handleModeChange(e.target.value as PeriodMode)}
            optionType="button"
            buttonStyle="solid"
          >
            <Radio.Button value="day">Day</Radio.Button>
            <Radio.Button value="week">Week</Radio.Button>
            <Radio.Button value="month">Month</Radio.Button>
            <Radio.Button value="custom">Custom</Radio.Button>
            <Radio.Button value="all">All</Radio.Button>
          </Radio.Group>
        </Col>
        {mode === 'custom' && (
          <Col>
            <RangePicker
              value={customRange}
              onChange={(v) => setCustomRange(v && v[0] && v[1] ? [v[0], v[1]] : null)}
              format="D MMM YYYY"
            />
          </Col>
        )}
        {(mode === 'day' || mode === 'week' || mode === 'month') && period && (
          <Col>
            <Space>
              <Button icon={<LeftOutlined />} onClick={() => setOffset((o) => o - 1)} />
              <DatePicker
                picker={mode === 'week' ? 'week' : mode === 'month' ? 'month' : 'date'}
                value={dayjs(period.from)}
                allowClear={false}
                format={
                  mode === 'week'
                    ? (d) => `Week ${d.isoWeek()}, ${d.isoWeekYear()}`
                    : mode === 'month'
                    ? 'MMMM YYYY'
                    : 'D MMM YYYY'
                }
                onChange={(d) => { if (d) setOffset(computeOffset(mode, d)) }}
                style={{ width: 200 }}
                variant="borderless"
              />
              <Button icon={<RightOutlined />} onClick={() => setOffset((o) => o + 1)} />
            </Space>
          </Col>
        )}
      </Row>

      {/* Filter row */}
      <Row gutter={[8, 8]} align="middle">
        {showPlanBudgetFilters && (
          <Col>
            <TreeSelect
              placeholder="All plans"
              allowClear
              style={{ minWidth: 220 }}
              value={filterPlanId}
              onChange={(v) => handlePlanSelect(v)}
              treeData={planTreeData}
              showSearch
              treeNodeFilterProp="title"
              popupMatchSelectWidth={320}
            />
          </Col>
        )}
        {showPlanBudgetFilters && filterPlanId && budgetOptions.length > 0 && (
          <Col>
            <Select
              placeholder="All budgets"
              allowClear
              style={{ minWidth: 180 }}
              value={filterBudgetId}
              onChange={(v) => setFilterBudgetId(v)}
              options={budgetOptions.map((b) => ({ value: b.id, label: b.name ?? b.id }))}
            />
          </Col>
        )}
        <Col>
          <Select
            placeholder="All accounts"
            allowClear
            style={{ minWidth: 180 }}
            value={filterAccountId}
            onChange={(v) => setFilterAccountId(v)}
            options={accountFilterData.map((a) => ({ value: a.id, label: a.name, type: a.type }))}
            showSearch
            filterOption={(input, opt) => String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
            optionRender={(opt) => (
              <span>
                {ACCOUNT_TYPE_ICON[(opt.data as { type: string }).type] ?? null}
                {opt.label}
              </span>
            )}
          />
        </Col>
        <Col>
          <InputNumber
            placeholder="Min"
            value={minAmount}
            onChange={(v) => setMinAmount(v)}
            style={{ width: 120 }}
            prefix="≥"
          />
        </Col>
        <Col>
          <InputNumber
            placeholder="Max"
            value={maxAmount}
            onChange={(v) => setMaxAmount(v)}
            style={{ width: 120 }}
            prefix="≤"
          />
        </Col>
      </Row>

      {loading && (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" />
        </div>
      )}

      {error && <Alert type="error" message={error} showIcon />}

      {!loading && !error && viewMode === 'chart' && (
        <div>
          <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 16 }}>
            <Radio.Group
              value={chartGroup}
              onChange={(e) => setChartGroup(e.target.value as ChartGroup)}
              optionType="button"
              size="small"
            >
              <Radio.Button value="day">Day</Radio.Button>
              <Radio.Button value="week">Week</Radio.Button>
              <Radio.Button value="month">Month</Radio.Button>
              <Radio.Button value="none">Each</Radio.Button>
            </Radio.Group>
            <Checkbox.Group
              value={chartLines}
              onChange={(v) => setChartLines(v as string[])}
              options={[
                { label: <span style={{ color: '#389e0d' }}>Income</span>, value: 'income' },
                { label: <span style={{ color: '#cf1322' }}>Expense</span>, value: 'expense' },
                { label: <span style={{ color: '#1677ff' }}>Balance</span>, value: 'total' },
              ]}
            />
          </div>
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={buildChartData(filteredTxs, chartGroup)} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11 }} />
              <RTooltip formatter={(v) => fmt(Number(v))} />
              <Legend />
              <ReferenceLine y={0} stroke="#888" strokeDasharray="3 3" />
              {chartLines.includes('income') && <Line type="monotone" dataKey="income" name="Income" stroke="#389e0d" strokeWidth={2} dot={{ r: 2 }} />}
              {chartLines.includes('expense') && <Line type="monotone" dataKey="expense" name="Expense" stroke="#cf1322" strokeWidth={2} dot={{ r: 2 }} />}
              {chartLines.includes('total') && <Line type="monotone" dataKey="total" name="Balance" stroke="#1677ff" strokeWidth={2} dot={{ r: 2 }} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {!loading && !error && viewMode === 'list' && (
        <>
          <Table
            dataSource={filteredTxs}
            columns={columns}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 50, hideOnSinglePage: true }}
            locale={{ emptyText: 'No executed transactions found.' }}
            summary={(rows) => {
              let income = 0
              let expense = 0
              rows.forEach((r) => {
                const kind = txKind(r)
                const v = r.amount ? parseFloat(r.amount) : 0
                if (kind === 'income') income += Math.abs(v)
                else if (kind === 'expense') expense += Math.abs(v)
              })
              const balance = income - expense
              return (
                <>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={columns.length - 2}>
                      <span style={{ color: '#3f8600' }}>Income</span>
                      {' / '}
                      <span style={{ color: '#cf1322' }}>Expense</span>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      <span style={{ color: '#3f8600' }}>{fmt(income)}</span>
                      {' / '}
                      <span style={{ color: '#cf1322' }}>{fmt(-expense)}</span>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={2} />
                  </Table.Summary.Row>
                  <Table.Summary.Row style={{ fontWeight: 600 }}>
                    <Table.Summary.Cell index={0} colSpan={columns.length - 2}>Balance</Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      <span style={{ color: balance < 0 ? '#cf1322' : balance > 0 ? '#3f8600' : undefined, fontWeight: 600 }}>{fmt(balance > 0 ? balance : -Math.abs(balance))}</span>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={2} />
                  </Table.Summary.Row>
                </>
              )
            }}
          />
        </>
      )}
    </Space>
  )
}
