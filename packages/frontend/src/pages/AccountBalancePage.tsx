import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Typography,
  Space,
  Checkbox,
  Radio,
  Row,
  Col,
  DatePicker,
  Spin,
  Alert,
  Empty,
  Switch,
} from 'antd'
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
import { computePlannedOn } from '../features/helpers'

dayjs.extend(isoWeek)

const { Title, Text } = Typography
const { RangePicker } = DatePicker

// ─── Types ───────────────────────────────────────────────────────────────────

type FullAccount = { id: string; name: string; type: string; initialBalance: string | null, isDefault: boolean }

type Tx = {
  id: string
  amount: string | null
  executedOn: string | null
  plannedOn: string | null
  dueDateConfig: string | null
  fromAccount?: { id: string; name: string; type: string } | null
  toAccount?: { id: string; name: string; type: string } | null
  budget?: { id: string; name: string; plan: { id: string; name: string; startDate: string; endDate: string } } | null
  plan?: { id: string; name: string; startDate: string; endDate: string } | null
}

type ChartGroup = 'day' | 'week' | 'month'
type DisplayRange = '6m' | '1y' | '2y' | 'all' | 'custom'
type FutureHorizon = '1m' | '3m' | '6m' | '1y' | '2y'

const FUTURE_HORIZON_MONTHS: Record<FutureHorizon, number> = { '1m': 1, '3m': 3, '6m': 6, '1y': 12, '2y': 24 }

// ─── Constants ───────────────────────────────────────────────────────────────

const ASSET_ACCOUNT_TYPES = ['CASH', 'BANK', 'INVESTMENT']
const LINE_COLORS = ['#1677ff', '#389e0d', '#d46b08', '#531dab', '#08979c', '#c41d7f', '#7cb305', '#faad14']
const TOTAL_COLOR = '#222'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmt(v: number): string {
  return (v < 0 ? '-' : '') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

function bucketKeyFn(date: string | Date, g: ChartGroup): string {
  const d = dayjs(date)
  if (g === 'day') return d.format('YYYY-MM-DD')
  if (g === 'week') return `${d.isoWeekYear()}-W${String(d.isoWeek()).padStart(2, '0')}`
  return d.format('YYYY-MM')
}

function bucketLabelFn(key: string, g: ChartGroup): string {
  if (g === 'day') return dayjs(key).format('D MMM')
  if (g === 'week') {
    const [yr, w] = key.split('-W').map(Number)
    return `W${w} '${String(yr).slice(2)}`
  }
  return dayjs(`${key}-01`).format('MMM YYYY')
}

function getDisplayBuckets(
  range: DisplayRange,
  customRange: [Dayjs, Dayjs] | null,
  g: ChartGroup,
  futureMonths: number,
): { fromBucket: string | null; toBucket: string } {
  const horizonBucket = bucketKeyFn(
    dayjs().add(futureMonths, 'month').format('YYYY-MM-DD'),
    g,
  )
  if (range === 'custom' && customRange) {
    return {
      fromBucket: bucketKeyFn(customRange[0].format('YYYY-MM-DD'), g),
      toBucket: bucketKeyFn(customRange[1].format('YYYY-MM-DD'), g),
    }
  }
  if (range === 'all') return { fromBucket: null, toBucket: horizonBucket }
  const pastMonths = range === '6m' ? 6 : range === '1y' ? 12 : 24
  const from = dayjs().subtract(pastMonths, 'month')
  return {
    fromBucket: bucketKeyFn(from.format('YYYY-MM-DD'), g),
    toBucket: horizonBucket,
  }
}

// ─── Chart data builder ───────────────────────────────────────────────────────

type LineDescriptor = { key: string; label: string; color: string; dashed: boolean }

function buildChartData(
  accountData: Array<{ account: FullAccount; txs: Tx[] }>,
  groupBy: ChartGroup,
  showTotal: boolean,
  fromBucket: string | null,
  toBucket: string,
  horizonDateStr: string,
): { data: Record<string, unknown>[]; todayLabel: string; lines: LineDescriptor[] } {
  if (accountData.length === 0) return { data: [], todayLabel: '', lines: [] }

  const today = toLocalDateStr(new Date())
  const todayBucket = bucketKeyFn(today, groupBy)

  // Collect all bucket keys from transactions + fill the full future horizon so the
  // projected line is continuous even when there are no planned transactions
  const allBucketKeys = new Set<string>([todayBucket])

  // Fill every bucket from today → horizonDateStr so projected line is unbroken
  const horizonDay = dayjs(horizonDateStr)
  let cur = dayjs(today)
  while (!cur.isAfter(horizonDay)) {
    allBucketKeys.add(bucketKeyFn(cur.format('YYYY-MM-DD'), groupBy))
    cur = groupBy === 'day' ? cur.add(1, 'day') : groupBy === 'week' ? cur.add(1, 'week') : cur.add(1, 'month')
  }

  const accountSeries = accountData.map(({ account, txs }) => {
    const initBal = parseFloat(account.initialBalance ?? '0') || 0
    const execDeltas = new Map<string, number>()
    const planDeltas = new Map<string, number>()

    const planend = txs.filter(tx => tx.executedOn === null && (tx.plannedOn !== null || tx.dueDateConfig !== null));

    for (const tx of txs) {
      const amt = parseFloat(tx.amount ?? '0') || 0
      // Determine signed delta relative to this account
      const signed =
        tx.toAccount?.id === account.id ? Math.abs(amt) :    // inflow  → +
        tx.fromAccount?.id === account.id ? -Math.abs(amt) : // outflow → -
        0

      if (tx.executedOn) {
        const k = bucketKeyFn(tx.executedOn, groupBy)
        allBucketKeys.add(k)
        execDeltas.set(k, (execDeltas.get(k) ?? 0) + signed)
      } else { 
        if (tx.plannedOn || tx.dueDateConfig) {
            const planStartDate = tx.plan ? tx.plan.startDate : tx.budget?.plan ? tx.budget.plan.startDate : null;
            const plannedOn = computePlannedOn(tx.dueDateConfig, planStartDate) ?? tx.plannedOn;
            if (plannedOn === null) continue
            const k = bucketKeyFn(plannedOn, groupBy)
            if (k > todayBucket) {
            // Only future planned transactions contribute to projection
            allBucketKeys.add(k)
            planDeltas.set(k, (planDeltas.get(k) ?? 0) + signed)
          }
        } else {
            console.log("checkpoint");
        }
      }
    }
    return { account, initBal, execDeltas, planDeltas }
  })

  const sortedKeys = [...allBucketKeys].sort()

  // Running cumulative balances
  const actualCumul = accountSeries.map((s) => s.initBal)
  let projCumul: number[] | null = null

  const data: Record<string, unknown>[] = []

  for (const key of sortedKeys) {
    // 1. Update actual cumulatives (executed txs, past only)
    if (key <= todayBucket) {
      accountSeries.forEach(({ execDeltas }, i) => {
        actualCumul[i] += execDeltas.get(key) ?? 0
      })
    }

    // 2. At today: snapshot actual balance as the starting point for projection
    if (key === todayBucket) {
      projCumul = actualCumul.slice()
    }

    // 3. Update projected cumulatives (planned txs, future only)
    if (key >= todayBucket && projCumul) {
      accountSeries.forEach(({ planDeltas }, i) => {
        projCumul![i] += planDeltas.get(key) ?? 0
      })
    }

    // Skip points outside the display range (but still computed cumulatives above)
    if (fromBucket && key < fromBucket) continue
    if (toBucket && key > toBucket) continue

    const label = bucketLabelFn(key, groupBy)
    const point: Record<string, unknown> = { key, label }

    let totalActual = 0
    let totalProjected = 0

    accountSeries.forEach(({ account }, i) => {
      if (key <= todayBucket) {
        point[`${account.id}_a`] = Math.round(actualCumul[i] * 100) / 100
        totalActual += actualCumul[i]
      }
      if (key >= todayBucket && projCumul) {
        point[`${account.id}_p`] = Math.round(projCumul[i] * 100) / 100
        totalProjected += projCumul[i]
      }
    })

    if (showTotal && accountData.length > 1) {
      if (key <= todayBucket) point['__total_a'] = Math.round(totalActual * 100) / 100
      if (key >= todayBucket && projCumul) point['__total_p'] = Math.round(totalProjected * 100) / 100
    }

    data.push(point)
  }

  // Build line descriptors for the chart
  const lines: LineDescriptor[] = []
  accountSeries.forEach(({ account }, i) => {
    const color = LINE_COLORS[i % LINE_COLORS.length]
    lines.push({ key: `${account.id}_a`, label: account.name, color, dashed: false })
    lines.push({ key: `${account.id}_p`, label: `${account.name} (projected)`, color, dashed: true })
  })
  if (showTotal && accountData.length > 1) {
    lines.push({ key: '__total_a', label: 'Total', color: TOTAL_COLOR, dashed: false })
    lines.push({ key: '__total_p', label: 'Total (projected)', color: TOTAL_COLOR, dashed: true })
  }

  return { data, todayLabel: bucketLabelFn(todayBucket, groupBy), lines }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AccountBalancePage() {
  const [accounts, setAccounts] = useState<FullAccount[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [txsByAccount, setTxsByAccount] = useState<Map<string, Tx[]>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [groupBy, setGroupBy] = useState<ChartGroup>('month')
  const [displayRange, setDisplayRange] = useState<DisplayRange>('1y')
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [futureHorizon, setFutureHorizon] = useState<FutureHorizon>('6m')
  const [showTotal, setShowTotal] = useState(true)

  // Fetch accounts once, pre-select all asset accounts
  useEffect(() => {
    apiClient.get<FullAccount[]>('/api/accounts').then((r) => {
      const assetAccounts = r.data.filter((a) => ASSET_ACCOUNT_TYPES.includes(a.type));
      setAccounts(assetAccounts);
      setSelectedIds(assetAccounts.filter(a => a.isDefault).map((a) => a.id));
    }).catch(() => {})
  }, [])

  // Fetch all transactions for each selected account (no date filter — needed for accurate running balance)
  const fetchTxs = useCallback(async () => {
    if (selectedIds.length === 0) { setTxsByAccount(new Map()); return }
    setLoading(true)
    setError(null)
    try {
      const results = await Promise.all(
        selectedIds.map(async (id) => {
          const res = await apiClient.get<Tx[]>('/api/transactions', { params: { accountId: id, isTemplate: 'false' } })
          return [id, res.data] as [string, Tx[]]
        })
      )
      setTxsByAccount(new Map(results))
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string }
      setError(e?.response?.data?.message ?? e?.message ?? 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [selectedIds])

  useEffect(() => { fetchTxs() }, [fetchTxs])

  const accountData = useMemo(() =>
    selectedIds
      .map((id) => {
        const account = accounts.find((a) => a.id === id)
        if (!account) return null
        return { account, txs: txsByAccount.get(id) ?? [] }
      })
      .filter(Boolean) as Array<{ account: FullAccount; txs: Tx[] }>,
    [selectedIds, accounts, txsByAccount]
  )

  const { fromBucket, toBucket } = useMemo(
    () => getDisplayBuckets(displayRange, customRange, groupBy, FUTURE_HORIZON_MONTHS[futureHorizon]),
    [displayRange, customRange, groupBy, futureHorizon]
  )

  // Horizon date string (YYYY-MM-DD) — used to fill future buckets in the chart
  const horizonDateStr = useMemo(() => {
    if (displayRange === 'custom' && customRange)
      return customRange[1].format('YYYY-MM-DD')
    return dayjs().add(FUTURE_HORIZON_MONTHS[futureHorizon], 'month').format('YYYY-MM-DD')
  }, [displayRange, customRange, futureHorizon])

  const { data, todayLabel, lines } = useMemo(
    () => buildChartData(accountData, groupBy, showTotal, fromBucket, toBucket, horizonDateStr),
    [accountData, groupBy, showTotal, fromBucket, toBucket, horizonDateStr]
  )

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Title level={4} style={{ margin: 0 }}>Account Balance</Title>

      {/* Account checkboxes */}
      {accounts.length > 0 && (
        <Checkbox.Group
          value={selectedIds}
          onChange={(v) => setSelectedIds(v as string[])}
          options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.type})` }))}
        />
      )}

      {/* Controls */}
      <Row align="middle" gutter={[16, 8]}>
        <Col>
          <Space size={4} direction="vertical" style={{ gap: 2 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>Past</Text>
            <Radio.Group
              value={displayRange}
              onChange={(e) => setDisplayRange(e.target.value as DisplayRange)}
              optionType="button"
              buttonStyle="solid"
            >
              <Radio.Button value="6m">6 M</Radio.Button>
              <Radio.Button value="1y">1 Y</Radio.Button>
              <Radio.Button value="2y">2 Y</Radio.Button>
              <Radio.Button value="all">All</Radio.Button>
              <Radio.Button value="custom">Custom</Radio.Button>
            </Radio.Group>
          </Space>
        </Col>
        <Col>
          <Space size={4} direction="vertical" style={{ gap: 2 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>Future projection</Text>
            <Radio.Group
              value={futureHorizon}
              onChange={(e) => setFutureHorizon(e.target.value as FutureHorizon)}
              optionType="button"
              buttonStyle="solid"
            >
              <Radio.Button value="1m">1 M</Radio.Button>
              <Radio.Button value="3m">3 M</Radio.Button>
              <Radio.Button value="6m">6 M</Radio.Button>
              <Radio.Button value="1y">1 Y</Radio.Button>
              <Radio.Button value="2y">2 Y</Radio.Button>
            </Radio.Group>
          </Space>
        </Col>
        {displayRange === 'custom' && (
          <Col>
            <RangePicker
              value={customRange}
              onChange={(v) => setCustomRange(v && v[0] && v[1] ? [v[0], v[1]] : null)}
              format="D MMM YYYY"
            />
          </Col>
        )}
        <Col>
          <Radio.Group
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as ChartGroup)}
            optionType="button"
            size="small"
          >
            <Radio.Button value="day">Day</Radio.Button>
            <Radio.Button value="week">Week</Radio.Button>
            <Radio.Button value="month">Month</Radio.Button>
          </Radio.Group>
        </Col>
        <Col>
          <Space size={6}>
            <Switch size="small" checked={showTotal} onChange={setShowTotal} />
            <Text type="secondary" style={{ fontSize: 12 }}>Show total</Text>
          </Space>
        </Col>
      </Row>

      {loading && <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>}
      {error && <Alert type="error" message={error} showIcon />}

      {!loading && !error && accounts.length === 0 && (
        <Empty description="No CASH, BANK or INVESTMENT accounts found" />
      )}

      {!loading && !error && data.length > 0 && (
        <>
          {/* Legend for actual vs projected */}
          <Row gutter={16}>
            <Col>
              <Space size={4}>
                <svg width="24" height="4"><line x1="0" y1="2" x2="24" y2="2" stroke="#888" strokeWidth="2" /></svg>
                <Text type="secondary" style={{ fontSize: 12 }}>Actual</Text>
              </Space>
            </Col>
            <Col>
              <Space size={4}>
                <svg width="24" height="4"><line x1="0" y1="2" x2="24" y2="2" stroke="#888" strokeWidth="1.5" strokeDasharray="5 3" /></svg>
                <Text type="secondary" style={{ fontSize: 12 }}>Projected (from scheduled plans)</Text>
              </Space>
            </Col>
          </Row>

          <ResponsiveContainer width="100%" height={420}>
            <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11 }} />
              <RTooltip formatter={(v) => fmt(Number(v))} />
              <Legend />
              {/* Today divider */}
              <ReferenceLine
                x={todayLabel}
                stroke="#666"
                strokeDasharray="4 4"
                label={{ value: 'Today', position: 'insideTopRight', fontSize: 10, fill: '#666' }}
              />
              <ReferenceLine y={0} stroke="#ddd" />
              {lines.map(({ key, label, color, dashed }) => (
                <Line
                  key={key}
                  dataKey={key}
                  name={label}
                  stroke={color}
                  strokeWidth={dashed ? 1.5 : 2.5}
                  strokeDasharray={dashed ? '6 3' : undefined}
                  strokeOpacity={dashed ? 0.65 : 1}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </>
      )}

      {!loading && !error && selectedIds.length > 0 && data.length === 0 && (
        <Empty description="No transaction data found for selected accounts in this period" />
      )}
    </Space>
  )
}
