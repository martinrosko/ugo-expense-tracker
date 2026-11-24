import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Checkbox, Col, DatePicker, Dropdown, Empty, Radio, Row, Select, Space, Spin, Table, Typography } from 'antd'
import { LeftOutlined, RightOutlined, UnorderedListOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  ReferenceLine,
} from 'recharts'
import apiClient from '../api/apiClient'
import PlanPerformance from '../components/PlanPerformance'
import PlanTransactionsDrawer, { type TransactionsScope } from '../components/PlanTransactionsDrawer'
import { periodSuffix, planLabel } from '../features/planLabel'
import { computeOffset, getPeriod, toLocalDateStr, type PeriodMode } from '../features/period'
import { budgetStats, planStats, sumStats, type BudgetStats, type BudgetWithTx, type TxSummary } from '../features/planStats'

const { Title, Text } = Typography
const { RangePicker } = DatePicker

type TemplateOption = { id: string; name: string | null; intervalType: string; isTemplate: boolean; startDate: string | null }

type Instance = {
  id: string
  name: string | null
  startDate: string | null
  endDate: string | null
  intervalType: string
  templateIntervalType?: string | null
  isTemplate: boolean
  statusCode: number
  budgets: (BudgetWithTx & { templateId?: string | null })[]
  transactions: TxSummary[]
}

type Series = 'planned' | 'actual' | 'reserved' | 'projected' | 'delta'
type Point = Record<Series, number> & { label: string; planId: string; budgetId?: string }
type View = 'combined' | 'split'

const SERIES: { key: Series; label: string; color: string }[] = [
  { key: 'planned', label: 'Planned', color: '#fa8c16' },
  { key: 'actual', label: 'Actual', color: '#1677ff' },
  { key: 'reserved', label: 'Reserved', color: '#91caff' },
  { key: 'projected', label: 'Projected', color: '#531dab' },
  { key: 'delta', label: 'Delta (+ = better than planned)', color: '#389e0d' },
]

const fmt = (v: number) =>
  (v < 0 ? '-' : '') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

const round = (v: number) => Math.round(v * 100) / 100

const AVERAGE_SIDES = [
  { key: 'income', label: 'Income', sign: 1, planned: (s: BudgetStats) => s.incPlanned, projected: (s: BudgetStats) => s.incActual + s.incReserved },
  { key: 'expenses', label: 'Expenses', sign: -1, planned: (s: BudgetStats) => s.expPlanned, projected: (s: BudgetStats) => s.expActual + s.expReserved },
  { key: 'net', label: 'Net', sign: 1, planned: (s: BudgetStats) => s.incPlanned - s.expPlanned, projected: (s: BudgetStats) => s.incActual + s.incReserved - s.expActual - s.expReserved },
]

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0)
const deltaColor = (v: number) => (v > 0 ? '#389e0d' : v < 0 ? '#cf1322' : undefined)

/** Average execution per plan or budget instance: planned vs projected (actual + reserved), as amount and as percent of planned. */
function ExecutionAverages({ stats, unit }: { stats: BudgetStats[]; unit: string }) {
  const cols = AVERAGE_SIDES.map((side) => {
    const per = stats.map((s) => ({ planned: side.planned(s), projected: side.projected(s) }))
    // Positive means better than planned: more income, or less spent
    const delta = (p: { planned: number; projected: number }) => side.sign * (p.projected - p.planned)
    // A period with nothing planned has no percentage
    const pcts = per.filter((p) => p.planned !== 0).map((p) => (delta(p) / Math.abs(p.planned)) * 100)
    return { ...side, avgPlanned: mean(per.map((p) => p.planned)), avgProjected: mean(per.map((p) => p.projected)), avgDelta: mean(per.map(delta)), avgPct: mean(pcts), hasPct: pcts.length > 0 }
  })
  const signed = (v: number) => (v > 0 ? '+' : '') + fmt(v)
  const lines = [
    { key: 'planned', label: 'Planned', cell: (c: (typeof cols)[number]) => fmt(c.avgPlanned) },
    { key: 'projected', label: 'Projected', cell: (c: (typeof cols)[number]) => fmt(c.avgProjected) },
    { key: 'delta', label: 'Delta', cell: (c: (typeof cols)[number]) => <Text strong style={{ color: deltaColor(c.avgDelta) }}>{signed(c.avgDelta)}</Text> },
    { key: 'pct', label: 'Delta %', cell: (c: (typeof cols)[number]) => c.hasPct ? <Text strong style={{ color: deltaColor(c.avgPct) }}>{`${c.avgPct > 0 ? '+' : ''}${c.avgPct.toFixed(1)} %`}</Text> : '\u2014' },
  ]
  return (
    <div>
      <Text strong>{`Average per ${unit} \u00b7 ${stats.length} in the period`}</Text>
      <Table
        size="small"
        pagination={false}
        rowKey="key"
        dataSource={lines}
        columns={[
          { title: '', dataIndex: 'label' },
          ...cols.map((c) => ({ title: c.label, key: c.key, align: 'right' as const, render: (_: unknown, line: (typeof lines)[number]) => line.cell(c) })),
        ]}
      />
      <Text type="secondary" style={{ fontSize: 11 }}>Projected = actual + still reserved. Delta is positive when better than planned (more income, less spent).</Text>
    </div>
  )
}

// Budgets of different plan instances are the same budget when they share a template; unlinked ones are matched by name
const budgetKeyOf = (b: { templateId?: string | null; name: string | null }) => b.templateId ?? `name:${b.name ?? ''}`

function toPoint(ref: { label: string; planId: string; budgetId?: string }, planned: number, actual: number, reserved: number, higherIsBetter: boolean): Point {
  const projected = actual + reserved
  return {
    ...ref,
    planned: round(planned),
    actual: round(actual),
    reserved: round(reserved),
    projected: round(projected),
    delta: round(higherIsBetter ? projected - planned : planned - projected),
  }
}

function ExecChart({ title, data, visible, onPick }: { title: string; data: Point[]; visible: Series[]; onPick: (p: Point, x: number, y: number) => void }) {
  const has = (s: Series) => visible.includes(s)
  const color = (s: Series) => SERIES.find((x) => x.key === s)!.color
  const name = (s: Series) => SERIES.find((x) => x.key === s)!.label
  const pick = (_d: unknown, index: number, e: { clientX: number; clientY: number }) => onPick(data[index], e.clientX, e.clientY)
  return (
    <div>
      <Title level={5}>{title}</Title>
      <ResponsiveContainer width="100%" height={380}>
        <ComposedChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis yAxisId="amount" tick={{ fontSize: 11 }} />
          <YAxis yAxisId="delta" orientation="right" tick={{ fontSize: 11 }} hide={!has('delta')} />
          <RTooltip formatter={(v) => fmt(Number(v))} />
          <Legend />
          <ReferenceLine yAxisId="amount" y={0} stroke="#888" strokeDasharray="3 3" />
          {has('actual') && <Bar yAxisId="amount" dataKey="actual" name={name('actual')} stackId="exec" fill={color('actual')} style={{ cursor: 'pointer' }} onClick={pick} />}
          {has('reserved') && <Bar yAxisId="amount" dataKey="reserved" name={name('reserved')} stackId="exec" fill={color('reserved')} style={{ cursor: 'pointer' }} onClick={pick} />}
          {has('planned') && (
            <Line yAxisId="amount" type="monotone" dataKey="planned" name={name('planned')} stroke={color('planned')} strokeWidth={2} strokeDasharray="6 3" dot={{ r: 3 }} />
          )}
          {has('projected') && (
            <Line yAxisId="amount" type="monotone" dataKey="projected" name={name('projected')} stroke={color('projected')} strokeWidth={2.5} dot={{ r: 3 }} />
          )}
          {has('delta') && (
            <Line yAxisId="delta" type="monotone" dataKey="delta" name={name('delta')} stroke={color('delta')} strokeWidth={1.5} strokeDasharray="2 2" dot={{ r: 2 }} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function ExecutionChartPage() {
  // Where the user clicked a bar, to anchor the menu there
  const [menu, setMenu] = useState<{ point: Point; x: number; y: number } | null>(null)
  const [selectedPlanId, setSelectedPlanId] = useState<string>()
  const [txScope, setTxScope] = useState<TransactionsScope | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [templates, setTemplates] = useState<TemplateOption[]>([])
  const [templateId, setTemplateId] = useState<string>()
  const [budgetKey, setBudgetKey] = useState<string>()
  const [instances, setInstances] = useState<Instance[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [mode, setMode] = useState<PeriodMode>('year')
  const [offset, setOffset] = useState(0)
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [view, setView] = useState<View>('combined')
  const [visible, setVisible] = useState<Series[]>(['planned', 'actual', 'reserved', 'projected', 'delta'])

  const period = useMemo(() => (mode === 'all' || mode === 'custom' ? null : getPeriod(mode, offset)), [mode, offset])

  useEffect(() => {
    apiClient.get<TemplateOption[]>('/api/plans', { params: { isTemplate: 'true' } })
      .then((r) => setTemplates(r.data))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!templateId) { setInstances([]); return }
    const params: Record<string, string> = { detailed: 'true', templateId }
    if (mode === 'custom' && customRange) {
      params.from = toLocalDateStr(customRange[0].toDate())
      params.to = toLocalDateStr(customRange[1].toDate())
    } else if (period) {
      params.from = toLocalDateStr(period.from)
      params.to = toLocalDateStr(period.to)
    } else if (mode === 'custom') {
      setInstances([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    apiClient.get<Instance[]>('/api/plans', { params })
      .then((res) => {
        if (cancelled) return
        // Cancelled plans never executed anything
        setInstances(res.data.filter((p) => !p.isTemplate && p.statusCode !== 4).sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? '')))
      })
      .catch((err: { response?: { data?: { message?: string } }; message?: string }) => {
        if (!cancelled) setError(err?.response?.data?.message ?? err?.message ?? 'Failed to load')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [templateId, mode, period, customRange, reloadKey])

  const budgetOptions = useMemo(() => {
    const names = new Map<string, string>()
    for (const p of instances) for (const b of p.budgets) names.set(budgetKeyOf(b), b.name ?? '(unnamed)')
    return [...names].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [instances])

  const rows = useMemo(() => {
    const out: { label: string; planId: string; budgetId?: string; stats: BudgetStats }[] = []
    for (const p of instances) {
      let stats: BudgetStats | null
      let budgetId: string | undefined
      if (budgetKey) {
        const b = p.budgets.find((x) => budgetKeyOf(x) === budgetKey)
        stats = b ? budgetStats(b, undefined, undefined, p.startDate, p.endDate, p.statusCode === 3) : null
        budgetId = b?.id
      } else {
        stats = planStats(p)
      }
      if (!stats) continue
      const label = p.startDate ? periodSuffix(p.templateIntervalType ?? p.intervalType, p.startDate) ?? planLabel(p) : planLabel(p)
      out.push({ label, planId: p.id, budgetId, stats })
    }
    return out
  }, [instances, budgetKey])

  const combined = useMemo(() => rows.map(({ stats: s, ...ref }) => toPoint(ref, s.planned, s.actual, s.reserved, true)), [rows])
  const income = useMemo(() => rows.map(({ stats: s, ...ref }) => toPoint(ref, s.incPlanned, s.incActual, s.incReserved, true)), [rows])
  const expense = useMemo(() => rows.map(({ stats: s, ...ref }) => toPoint(ref, s.expPlanned, s.expActual, s.expReserved, false)), [rows])

  function handleModeChange(m: PeriodMode) { setMode(m); setOffset(0) }

  function showTransactions(p: Point) {
    setTxScope({
      title: p.label,
      planId: p.budgetId ? undefined : p.planId,
      budgetId: p.budgetId,
      qs: p.budgetId ? `budgetId=${p.budgetId}` : `planId=${p.planId}`,
    })
  }

  const onPick = (p: Point, x: number, y: number) => {
    setSelectedPlanId(p.planId)
    setMenu({ point: p, x, y })
  }
  const selectedRow = rows.find((r) => r.planId === selectedPlanId)
  const totals = useMemo(() => sumStats(rows.map((r) => r.stats)), [rows])

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Title level={4} style={{ margin: 0 }}>Plan & Budget Execution</Title>

      <Space wrap>
        <Select
          showSearch
          placeholder="Select a plan template…"
          style={{ width: 320 }}
          value={templateId}
          onChange={(v) => { setTemplateId(v); setBudgetKey(undefined) }}
          optionFilterProp="label"
          options={templates.map((t) => ({ value: t.id, label: planLabel(t) }))}
        />
        <Select
          allowClear
          showSearch
          placeholder="Whole plan"
          style={{ width: 280 }}
          disabled={!templateId}
          value={budgetKey}
          onChange={setBudgetKey}
          optionFilterProp="label"
          options={budgetOptions}
        />
      </Space>

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

      <Row align="middle" gutter={[16, 8]}>
        <Col>
          <Radio.Group value={view} onChange={(e) => setView(e.target.value)} optionType="button" size="small">
            <Radio.Button value="combined">Income + expenses</Radio.Button>
            <Radio.Button value="split">Income vs expenses</Radio.Button>
          </Radio.Group>
        </Col>
        <Col>
          <Checkbox.Group
            value={visible}
            onChange={(v) => setVisible(v as Series[])}
            options={SERIES.map((s) => ({ label: <span style={{ color: s.color }}>{s.label}</span>, value: s.key }))}
          />
        </Col>
      </Row>

      {loading && <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>}
      {error && <Alert type="error" title={error} showIcon />}

      {!loading && !error && !templateId && <Empty description="Select a plan template to see how its plans were executed" />}
      {!loading && !error && templateId && rows.length === 0 && (
        <Empty description={budgetKey ? 'This budget does not appear in the plans of this period' : 'No plans found for this template in this period'} />
      )}

      {!loading && !error && rows.length > 0 && (view === 'combined' ? (
        <ExecChart title="Net (income + expenses)" data={combined} visible={visible} onPick={onPick} />
      ) : (
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}><ExecChart title="Income" data={income} visible={visible} onPick={onPick} /></Col>
          <Col xs={24} xl={12}><ExecChart title="Expenses" data={expense} visible={visible} onPick={onPick} /></Col>
        </Row>
      ))}

      {!loading && !error && rows.length > 0 && (
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={10}>
            <Card size="small" style={{ height: '100%' }}>
              <PlanPerformance title={`Total \u00b7 ${rows.length} ${budgetKey ? 'budget' : 'plan'}${rows.length === 1 ? '' : 's'}`} stats={totals} />
            </Card>
          </Col>
          <Col xs={24} xl={14}>
            <Card size="small" style={{ height: '100%' }}>
              <ExecutionAverages stats={rows.map((r) => r.stats)} unit={budgetKey ? 'budget' : 'plan'} />
            </Card>
          </Col>
        </Row>
      )}

      {selectedRow && (
        <Card size="small" style={{ maxWidth: 640 }}>
          <PlanPerformance title={selectedRow.label} stats={selectedRow.stats} />
        </Card>
      )}

      <PlanTransactionsDrawer scope={txScope} onClose={() => setTxScope(null)} onChanged={() => setReloadKey((k) => k + 1)} />

      <Dropdown
        open={menu !== null}
        onOpenChange={(open) => { if (!open) setMenu(null) }}
        trigger={['click']}
        menu={{
          items: [{ key: 'tx', icon: <UnorderedListOutlined />, label: menu ? `Show transactions – ${menu.point.label}` : '' }],
          onClick: () => { if (menu) showTransactions(menu.point) },
        }}
      >
        <span style={{ position: 'fixed', left: menu?.x ?? 0, top: menu?.y ?? 0, width: 1, height: 1 }} />
      </Dropdown>
    </Space>
  )
}
