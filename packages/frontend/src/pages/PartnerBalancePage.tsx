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

const { Title, Text } = Typography
const { RangePicker } = DatePicker

// ─── Types ───────────────────────────────────────────────────────────────────

type Account = { id: string; name: string; type: string }

type Transaction = {
  id: string
  amount: string | null
  executedOn: string | null
  type: string
  fromAccount?: { id: string; name: string; type: string } | null
  toAccount?: { id: string; name: string; type: string } | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type PeriodMode = 'month' | 'quarter' | 'year' | 'custom' | 'all'

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getPeriod(mode: Exclude<PeriodMode, 'all' | 'custom'>, offset: number): { from: Date; to: Date; label: string } {
  const now = new Date()
  if (mode === 'month') {
    const base = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const from = new Date(base.getFullYear(), base.getMonth(), 1)
    const to = new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59, 999)
    return { from, to, label: from.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }
  }
  if (mode === 'quarter') {
    const currentQ = Math.floor(now.getMonth() / 3)
    const qMonth = (currentQ + offset) * 3
    const base = new Date(now.getFullYear(), qMonth, 1)
    const y = base.getFullYear()
    const m = base.getMonth()
    const from = new Date(y, m, 1)
    const to = new Date(y, m + 3, 0, 23, 59, 59, 999)
    const q = Math.floor(m / 3) + 1
    return { from, to, label: `Q${q} ${y}` }
  }
  // year
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

type ChartGroup = 'day' | 'week' | 'month'

function fmt(v: number): string {
  return (v < 0 ? '-' : '') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

const ASSET_TYPES = new Set(['CASH', 'BANK', 'INVESTMENT'])

const LINE_COLORS = ['#1677ff', '#389e0d', '#cf1322', '#d46b08', '#531dab', '#08979c', '#c41d7f', '#7cb305']

// ─── Build chart data ────────────────────────────────────────────────────────

type PartnerData = { accountId: string; name: string; txs: Transaction[] }

function buildChartData(partners: PartnerData[], groupBy: ChartGroup): Record<string, unknown>[] {
  if (partners.length === 0) return []

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

  // Collect all bucket keys
  const allKeys = new Set<string>()
  const partnerBuckets = partners.map(({ accountId, name, txs }) => {
    const buckets = new Map<string, number>()
    for (const tx of txs) {
      if (!tx.executedOn) continue
      const key = bucketKey(tx.executedOn)
      allKeys.add(key)
      const amt = tx.amount ? parseFloat(tx.amount) : 0
      // Determine direction relative to the partner:
      // If partner is fromAccount (they pay us) → positive (we receive)
      // If partner is toAccount (we pay them) → negative (we owe/pay)
      const fromIsPartner = tx.fromAccount?.id === accountId
      const toIsPartner = tx.toAccount?.id === accountId
      let signed = 0
      if (fromIsPartner && !toIsPartner) {
        // Partner → us: if partner is non-asset, this is income for us = positive balance with partner
        signed = Math.abs(amt)
      } else if (toIsPartner && !fromIsPartner) {
        // Us → partner: expense for us = negative balance with partner
        signed = -Math.abs(amt)
      }
      buckets.set(key, (buckets.get(key) ?? 0) + signed)
    }
    return { name, buckets }
  })

  // Sort keys chronologically, then build cumulative data
  const sortedKeys = [...allKeys].sort()
  const cumulative = partnerBuckets.map(() => 0)

  return sortedKeys.map((key) => {
    const point: Record<string, unknown> = { label: bucketLabel(key) }
    partnerBuckets.forEach(({ name, buckets }, i) => {
      cumulative[i] += buckets.get(key) ?? 0
      point[name] = Math.round(cumulative[i] * 100) / 100
    })
    return point
  })
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PartnerBalancePage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [partnerData, setPartnerData] = useState<PartnerData[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [mode, setMode] = useState<PeriodMode>('year')
  const [offset, setOffset] = useState(0)
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [chartGroup, setChartGroup] = useState<ChartGroup>('month')

  const period = useMemo(() => {
    if (mode === 'all' || mode === 'custom') return null
    return getPeriod(mode, offset)
  }, [mode, offset])

  // Fetch accounts once
  useEffect(() => {
    apiClient.get<Account[]>('/api/accounts').then((r) => {
      setAccounts(r.data.filter((a) => a.type === 'PAYMENT_PARTNER'))
    }).catch(() => {})
  }, [])

  // Fetch transactions for each selected partner
  const fetchPartnerData = useCallback(async () => {
    if (selectedIds.length === 0) {
      setPartnerData([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, string> = { executed: 'true' }
      if (mode === 'custom' && customRange?.[0] && customRange?.[1]) {
        params.from = toLocalDateStr(customRange[0].toDate())
        params.to = toLocalDateStr(customRange[1].toDate())
      } else if (period) {
        params.from = toLocalDateStr(period.from)
        params.to = toLocalDateStr(period.to)
      }

      const results = await Promise.all(
        selectedIds.map(async (id) => {
          const account = accounts.find((a) => a.id === id)
          const res = await apiClient.get<Transaction[]>('/api/transactions', {
            params: { ...params, accountId: id },
          })
          return { accountId: id, name: account?.name ?? id, txs: res.data }
        })
      )
      setPartnerData(results)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string }
      setError(e?.response?.data?.message ?? e?.message ?? 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [selectedIds, accounts, mode, period, customRange])

  useEffect(() => { fetchPartnerData() }, [fetchPartnerData])

  const chartData = useMemo(() => buildChartData(partnerData, chartGroup), [partnerData, chartGroup])
  const partnerNames = partnerData.map((p) => p.name)

  function handleModeChange(m: PeriodMode) {
    setMode(m)
    setOffset(0)
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Title level={4} style={{ margin: 0 }}>Partner Balance</Title>

      {/* Partner selector */}
      <Select
        mode="multiple"
        placeholder="Select partners to compare..."
        style={{ width: '100%', maxWidth: 600 }}
        value={selectedIds}
        onChange={setSelectedIds}
        options={accounts.map((a) => ({ value: a.id, label: a.name }))}
        showSearch
        filterOption={(input, opt) => String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
      />

      {/* Period controls */}
      <Row align="middle" gutter={[8, 8]}>
        <Col>
          <Radio.Group
            value={mode}
            onChange={(e) => handleModeChange(e.target.value as PeriodMode)}
            optionType="button"
            buttonStyle="solid"
          >
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
        <Col>
          <Radio.Group
            value={chartGroup}
            onChange={(e) => setChartGroup(e.target.value as ChartGroup)}
            optionType="button"
            size="small"
          >
            <Radio.Button value="day">Day</Radio.Button>
            <Radio.Button value="week">Week</Radio.Button>
            <Radio.Button value="month">Month</Radio.Button>
          </Radio.Group>
        </Col>
      </Row>

      {loading && (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" />
        </div>
      )}

      {error && <Alert type="error" message={error} showIcon />}

      {!loading && !error && selectedIds.length === 0 && (
        <Empty description="Select one or more partners to see their balance over time" />
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
            {partnerNames.map((name, i) => (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                stroke={LINE_COLORS[i % LINE_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 2 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}

      {!loading && !error && selectedIds.length > 0 && chartData.length === 0 && (
        <Empty description="No transactions found for the selected partners in this period" />
      )}
    </Space>
  )
}
