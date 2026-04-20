import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Typography,
  Space,
  Select,
  Radio,
  Row,
  Col,
  DatePicker,
  Button,
  Spin,
  Alert,
  Empty,
  Checkbox,
} from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import apiClient from '../api/apiClient'
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

dayjs.extend(isoWeek)

const { Title } = Typography
const { RangePicker } = DatePicker

// ─── Types ───────────────────────────────────────────────────────────────────

type PlanOption = {
  id: string; name: string | null; isTemplate: boolean
  intervalType: string; startDate: string | null; templateId: string | null; statusCode: number
}
type BudgetOption = { id: string; name: string | null; planId: string }

type Transaction = {
  id: string; amount: string | null; executedOn: string | null; type: string
  fromAccount?: { id: string; type: string } | null
  toAccount?: { id: string; type: string } | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type PeriodMode = 'month' | 'quarter' | 'year' | 'custom' | 'all'

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
  if (mode === 'month') {
    const base = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const to = new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59, 999)
    return { from: base, to, label: base.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }
  }
  if (mode === 'quarter') {
    const currentQ = Math.floor(now.getMonth() / 3)
    const qMonth = (currentQ + offset) * 3
    const base = new Date(now.getFullYear(), qMonth, 1)
    const y = base.getFullYear(); const m = base.getMonth()
    return { from: new Date(y, m, 1), to: new Date(y, m + 3, 0, 23, 59, 59, 999), label: `Q${Math.floor(m / 3) + 1} ${y}` }
  }
  const year = now.getFullYear() + offset
  return { from: new Date(year, 0, 1), to: new Date(year, 11, 31, 23, 59, 59, 999), label: String(year) }
}

function computeOffset(mode: Exclude<PeriodMode, 'all' | 'custom'>, picked: Dayjs): number {
  const now = new Date()
  if (mode === 'month') return (picked.year() - now.getFullYear()) * 12 + (picked.month() - now.getMonth())
  if (mode === 'quarter') {
    const currentQ = Math.floor(now.getMonth() / 3)
    const pickedQ = Math.floor(picked.month() / 3)
    return (picked.year() - now.getFullYear()) * 4 + (pickedQ - currentQ)
  }
  return picked.year() - now.getFullYear()
}

function fmt(v: number): string {
  return (v < 0 ? '-' : '') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

const ASSET_TYPES = new Set(['CASH', 'BANK', 'INVESTMENT'])
type TxKind = 'expense' | 'income' | 'transfer'
function txKind(tx: Transaction): TxKind {
  const from = tx.fromAccount?.type ?? ''
  const to = tx.toAccount?.type ?? ''
  if (ASSET_TYPES.has(from) && ASSET_TYPES.has(to)) return 'transfer'
  if (ASSET_TYPES.has(to) && !ASSET_TYPES.has(from)) return 'income'
  return 'expense'
}

type ChartGroup = 'day' | 'week' | 'month'

const LINE_COLORS = ['#1677ff', '#389e0d', '#cf1322', '#d46b08', '#531dab', '#08979c', '#c41d7f', '#7cb305', '#13c2c2', '#faad14']

// ─── Chart data ──────────────────────────────────────────────────────────────

type SeriesData = { key: string; label: string; txs: Transaction[] }
type ChartLine = 'income' | 'expense' | 'balance'

function buildChartData(
  series: SeriesData[],
  groupBy: ChartGroup,
  lines: ChartLine[],
): { data: Record<string, unknown>[]; lineKeys: string[] } {
  if (series.length === 0) return { data: [], lineKeys: [] }

  const bucketKey = (date: string) => {
    const d = dayjs(date)
    if (groupBy === 'day') return d.format('YYYY-MM-DD')
    if (groupBy === 'week') return `${d.isoWeekYear()}-W${String(d.isoWeek()).padStart(2, '0')}`
    return d.format('YYYY-MM')
  }
  const bucketLabel = (key: string) => {
    if (groupBy === 'day') return dayjs(key).format('D MMM')
    if (groupBy === 'week') {
      const [yr, w] = key.split('-W').map(Number)
      return `W${w} '${String(yr).slice(2)}`
    }
    return dayjs(`${key}-01`).format('MMM YYYY')
  }

  // Build per-series buckets
  const allKeys = new Set<string>()
  const seriesBuckets = series.map(({ label, txs }) => {
    const buckets = new Map<string, { inc: number; exp: number }>()
    for (const tx of txs) {
      if (!tx.executedOn) continue
      const key = bucketKey(tx.executedOn)
      allKeys.add(key)
      const kind = txKind(tx)
      const v = tx.amount ? Math.abs(parseFloat(tx.amount)) : 0
      const existing = buckets.get(key) ?? { inc: 0, exp: 0 }
      if (kind === 'income') existing.inc += v
      else if (kind === 'expense') existing.exp += v
      buckets.set(key, existing)
    }
    return { label, buckets }
  })

  const sortedKeys = [...allKeys].sort()
  const cumIncome = seriesBuckets.map(() => 0)
  const cumExpense = seriesBuckets.map(() => 0)

  const lineKeys: string[] = []
  for (const s of series) {
    for (const l of lines) {
      const suffix = l === 'income' ? ' ↑' : l === 'expense' ? ' ↓' : ' Δ'
      lineKeys.push(s.label + suffix)
    }
  }

  const data = sortedKeys.map((key) => {
    const point: Record<string, unknown> = { label: bucketLabel(key) }
    seriesBuckets.forEach(({ label, buckets }, i) => {
      const b = buckets.get(key) ?? { inc: 0, exp: 0 }
      cumIncome[i] += b.inc
      cumExpense[i] += b.exp
      if (lines.includes('income')) point[label + ' ↑'] = Math.round(cumIncome[i] * 100) / 100
      if (lines.includes('expense')) point[label + ' ↓'] = Math.round(cumExpense[i] * 100) / 100
      if (lines.includes('balance')) point[label + ' Δ'] = Math.round((cumIncome[i] - cumExpense[i]) * 100) / 100
    })
    return point
  })

  return { data, lineKeys }
}

// ─── Page ────────────────────────────────────────────────────────────────────

type Selection = { type: 'plan' | 'budget'; id: string; label: string }

export default function BudgetChartPage() {
  const [allPlans, setAllPlans] = useState<PlanOption[]>([])
  const [allBudgets, setAllBudgets] = useState<BudgetOption[]>([])
  const [selections, setSelections] = useState<string[]>([]) // "plan:id" or "budget:id"
  const [seriesData, setSeriesData] = useState<SeriesData[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [mode, setMode] = useState<PeriodMode>('year')
  const [offset, setOffset] = useState(0)
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [chartGroup, setChartGroup] = useState<ChartGroup>('month')
  const [chartLines, setChartLines] = useState<ChartLine[]>(['expense', 'income', 'balance'])

  const period = useMemo(() => {
    if (mode === 'all' || mode === 'custom') return null
    return getPeriod(mode, offset)
  }, [mode, offset])

  // Fetch reference data
  useEffect(() => {
    apiClient.get<PlanOption[]>('/api/plans').then((r) => setAllPlans(r.data)).catch(() => {})
    apiClient.get<BudgetOption[]>('/api/budgets').then((r) => setAllBudgets(r.data)).catch(() => {})
  }, [])

  // Build select options: plans grouped as tree, budgets grouped under their plan
  const selectOptions = useMemo(() => {
    const INTERVAL_ORDER: Record<string, number> = { YEARLY: 0, MONTHLY: 1, WEEKLY: 2, ONE_TIME: 3 }

    // Plans section
    const instances = allPlans.filter((p) => !p.isTemplate && (p.statusCode === 1 || p.statusCode === 3))
      .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))
    const templates = allPlans.filter((p) => p.isTemplate)
      .sort((a, b) => (INTERVAL_ORDER[a.intervalType] ?? 9) - (INTERVAL_ORDER[b.intervalType] ?? 9) || (a.name ?? '').localeCompare(b.name ?? ''))

    const planOpts: { value: string; label: string }[] = []
    for (const tpl of templates) {
      const children = instances.filter((p) => p.templateId === tpl.id)
      for (const p of children) {
        planOpts.push({ value: `plan:${p.id}`, label: `📋 ${planLabel(p)}` })
      }
    }
    // Standalone plans
    for (const p of instances.filter((p) => !p.templateId)) {
      planOpts.push({ value: `plan:${p.id}`, label: `📋 ${planLabel(p)}` })
    }

    // Budget options grouped by plan
    const budgetOpts: { value: string; label: string }[] = []
    for (const b of allBudgets) {
      const plan = allPlans.find((p) => p.id === b.planId)
      const planSuffix = plan ? ` (${planLabel(plan)})` : ''
      budgetOpts.push({ value: `budget:${b.id}`, label: `💰 ${b.name ?? '(unnamed)'}${planSuffix}` })
    }

    return [
      { label: 'Plans', options: planOpts },
      { label: 'Budgets', options: budgetOpts },
    ]
  }, [allPlans, allBudgets])

  // Parse selections into typed objects
  const parsed = useMemo<Selection[]>(() =>
    selections.map((s) => {
      const [type, id] = s.split(':') as ['plan' | 'budget', string]
      const label = selectOptions.flatMap((g) => g.options).find((o) => o.value === s)?.label ?? id
      return { type, id, label: label.replace(/^[📋💰] /, '') }
    }),
  [selections, selectOptions])

  // Fetch transactions for each selection
  const fetchData = useCallback(async () => {
    if (parsed.length === 0) { setSeriesData([]); return }
    setLoading(true)
    setError(null)
    try {
      const dateParams: Record<string, string> = { executed: 'true' }
      if (mode === 'custom' && customRange?.[0] && customRange?.[1]) {
        dateParams.from = toLocalDateStr(customRange[0].toDate())
        dateParams.to = toLocalDateStr(customRange[1].toDate())
      } else if (period) {
        dateParams.from = toLocalDateStr(period.from)
        dateParams.to = toLocalDateStr(period.to)
      }

      const results = await Promise.all(
        parsed.map(async ({ type, id, label }) => {
          const params = { ...dateParams, ...(type === 'plan' ? { planId: id } : { budgetId: id }) }
          const res = await apiClient.get<Transaction[]>('/api/transactions', { params })
          return { key: `${type}:${id}`, label, txs: res.data }
        })
      )
      setSeriesData(results)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string }
      setError(e?.response?.data?.message ?? e?.message ?? 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [parsed, mode, period, customRange])

  useEffect(() => { fetchData() }, [fetchData])

  const { data: chartData, lineKeys } = useMemo(
    () => buildChartData(seriesData, chartGroup, chartLines),
    [seriesData, chartGroup, chartLines],
  )

  function handleModeChange(m: PeriodMode) { setMode(m); setOffset(0) }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Title level={4} style={{ margin: 0 }}>Budget & Plan Chart</Title>

      {/* Selector */}
      <Select
        mode="multiple"
        placeholder="Select plans or budgets to compare..."
        style={{ width: '100%', maxWidth: 700 }}
        value={selections}
        onChange={setSelections}
        options={selectOptions}
        showSearch
        filterOption={(input, opt) => String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
        maxTagCount="responsive"
      />

      {/* Period controls */}
      <Row align="middle" gutter={[8, 8]}>
        <Col>
          <Radio.Group value={mode} onChange={(e) => handleModeChange(e.target.value)} optionType="button" buttonStyle="solid">
            <Radio.Button value="month">Month</Radio.Button>
            <Radio.Button value="quarter">Quarter</Radio.Button>
            <Radio.Button value="year">Year</Radio.Button>
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
        {(mode === 'month' || mode === 'quarter' || mode === 'year') && period && (
          <Col>
            <Space>
              <Button icon={<LeftOutlined />} onClick={() => setOffset((o) => o - 1)} />
              <DatePicker
                picker={mode === 'month' ? 'month' : mode === 'quarter' ? 'quarter' : 'year'}
                value={dayjs(period.from)}
                allowClear={false}
                format={mode === 'month' ? 'MMMM YYYY' : mode === 'quarter' ? (d) => `Q${Math.floor(d.month() / 3) + 1} ${d.year()}` : 'YYYY'}
                onChange={(d) => { if (d) setOffset(computeOffset(mode, d)) }}
                style={{ width: 200 }}
                variant="borderless"
              />
              <Button icon={<RightOutlined />} onClick={() => setOffset((o) => o + 1)} />
            </Space>
          </Col>
        )}
      </Row>

      {/* Chart controls */}
      <Row align="middle" gutter={[16, 8]}>
        <Col>
          <Radio.Group value={chartGroup} onChange={(e) => setChartGroup(e.target.value)} optionType="button" size="small">
            <Radio.Button value="day">Day</Radio.Button>
            <Radio.Button value="week">Week</Radio.Button>
            <Radio.Button value="month">Month</Radio.Button>
          </Radio.Group>
        </Col>
        <Col>
          <Checkbox.Group
            value={chartLines}
            onChange={(v) => setChartLines(v as ChartLine[])}
            options={[
              { label: <span style={{ color: '#389e0d' }}>Income</span>, value: 'income' },
              { label: <span style={{ color: '#cf1322' }}>Expense</span>, value: 'expense' },
              { label: <span style={{ color: '#1677ff' }}>Balance</span>, value: 'balance' },
            ]}
          />
        </Col>
      </Row>

      {loading && <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>}
      {error && <Alert type="error" message={error} showIcon />}

      {!loading && !error && selections.length === 0 && (
        <Empty description="Select plans or budgets to see cumulative income & expense over time" />
      )}

      {!loading && !error && chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={420}>
          <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11 }} />
            <RTooltip formatter={(v) => fmt(Number(v))} />
            <Legend />
            <ReferenceLine y={0} stroke="#888" strokeDasharray="3 3" />
            {lineKeys.map((key, i) => {
              // Color: cycle base color per series, vary shade by line type
              const seriesIdx = Math.floor(i / chartLines.length)
              const lineType = key.endsWith(' ↑') ? 'income' : key.endsWith(' ↓') ? 'expense' : 'balance'
              const baseColor = LINE_COLORS[seriesIdx % LINE_COLORS.length]
              const stroke = lineType === 'income' ? '#389e0d' : lineType === 'expense' ? '#cf1322' : baseColor
              const dash = lineType === 'income' ? '6 3' : lineType === 'expense' ? '2 2' : undefined
              return (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={stroke}
                  strokeWidth={lineType === 'balance' ? 2.5 : 1.5}
                  strokeDasharray={dash}
                  dot={{ r: 2 }}
                  connectNulls
                />
              )
            })}
          </LineChart>
        </ResponsiveContainer>
      )}

      {!loading && !error && selections.length > 0 && chartData.length === 0 && (
        <Empty description="No transactions found for the selected items in this period" />
      )}
    </Space>
  )
}
