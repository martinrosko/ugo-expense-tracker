import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Alert, Button, Space, Spin, Table, Tag, Tooltip, Typography } from 'antd'
import { ArrowLeftOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import apiClient from '../api/apiClient'
import LogTransactionModal from '../components/LogTransactionModal'
import RowActions from '../components/RowActions'
import { usePlanTxActions, type TxActionContext } from '../features/usePlanTxActions'
import {
  apiError, byExecutedNewestFirst, byPlannedDate, direction, num, resolveAll,
  type Account, type RawPlan, type Tx,
} from '../features/planTransactions'
import { planLabel } from '../features/planLabel'

const { Title, Text } = Typography

// ─── Types ───────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<number, string> = { 0: 'Draft', 1: 'Active', 2: 'Scheduled', 3: 'Completed', 4: 'Cancelled' }
const STATUS_COLOR: Record<number, string> = { 0: 'default', 1: 'green', 2: 'blue', 3: 'cyan', 4: 'red' }

function fmt(v: number | null): string {
  if (v === null) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString('sk-SK') : '—')
const amountColor = (v: number) => (v < 0 ? '#cf1322' : v > 0 ? '#3f8600' : undefined)

type BudgetRow = {
  key: string
  name: string
  envelope: number | null
  executed: number
  pending: number
  children?: TxRow[]
}
type TxRow = { key: string; tx: Tx }
type GridRow = BudgetRow | TxRow

const isTxRow = (row: GridRow): row is TxRow => 'tx' in row

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PlanDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [plan, setPlan] = useState<RawPlan | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logOpen, setLogOpen] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    try {
      const [planRes, accountsRes] = await Promise.all([
        apiClient.get<RawPlan>(`/api/plans/${id}`),
        apiClient.get<Account[]>('/api/accounts'),
      ])
      setPlan(planRes.data)
      setAccounts(accountsRes.data)
      setError(null)
    } catch (err) {
      setError(apiError(err, 'Failed to load plan'))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])

  const { budgetRows, executed } = useMemo(() => {
    if (!plan) return { budgetRows: [] as BudgetRow[], executed: [] as Tx[] }
    const all = resolveAll(plan, accountMap)
    const signed = (t: Tx, value: number | null) => (value ?? 0) * (direction(t.from, t.to) || -1)
    const rows: BudgetRow[] = [
      ...plan.budgets.map((b) => ({ id: b.id, name: b.name ?? b.template?.name ?? '(unnamed)', envelope: num(b.amount ?? b.template?.amount) })),
      { id: '__general__', name: 'General', envelope: null as number | null },
    ].map((row) => {
      const txs = all.filter((t) => (row.id === '__general__' ? t.budgetId === null : t.budgetId === row.id))
      const upcoming = txs.filter((t) => !t.executedOn).sort(byPlannedDate)
      return {
        key: row.id,
        name: row.name,
        envelope: row.envelope,
        executed: txs.filter((t) => t.executedOn).reduce((s, t) => s + signed(t, t.amount), 0),
        pending: upcoming.reduce((s, t) => s + signed(t, t.plannedAmount), 0),
        children: upcoming.length > 0 ? upcoming.map((t) => ({ key: t.id, tx: t })) : undefined,
        count: txs.length,
      }
    }).filter((row) => row.key !== '__general__' || row.count > 0)
      .map(({ count: _count, ...row }) => row)
    return {
      budgetRows: rows,
      executed: all.filter((t) => t.executedOn).sort(byExecutedNewestFirst),
    }
  }, [plan, accountMap])

  const { actionsFor, modals } = usePlanTxActions(load)

  if (loading) return <div style={{ textAlign: 'center', padding: 64 }}><Spin size="large" /></div>
  if (error || !plan) return <Alert type="error" message={error ?? 'Plan not found'} showIcon />

  const completed = plan.statusCode === 3
  const active = plan.statusCode === 1
  const title = planLabel({ name: plan.name ?? plan.template?.name ?? null, isTemplate: plan.isTemplate, intervalType: plan.intervalType, startDate: plan.startDate })
  const dateRange = [plan.startDate, plan.endDate].filter(Boolean).map((d) => new Date(d!).toLocaleDateString('sk-SK')).join(' – ')

  const nameCell = (t: Tx) => (
    <Space size={4}>
      <span>{t.name}</span>
      {t.templateId && <Tag style={{ fontSize: 11 }}>template</Tag>}
    </Space>
  )
  const accountsCell = (t: Tx) => `${t.from?.name ?? '?'} → ${t.to?.name ?? '?'}`

  const txContext = (t: Tx): TxActionContext => ({
    id: t.id, planId: plan.id, planStatus: plan.statusCode, budgetCompleted: t.budgetCompleted, templateId: t.templateId, executed: t.executedOn !== null,
  })
  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="large">
      <Space align="center" wrap>
        <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => navigate('/plans')} />
        <Title level={4} style={{ margin: 0 }}>{title}</Title>
        <Tag color={STATUS_COLOR[plan.statusCode]}>{STATUS_LABEL[plan.statusCode]}</Tag>
        {dateRange && <Text type="secondary">{dateRange}</Text>}
        {!completed && (
          <Tooltip title="Edit plan">
            <Button size="small" type="text" icon={<EditOutlined />} onClick={() => navigate(`/plans/${plan.id}/edit`)} />
          </Tooltip>
        )}
        {(active || completed) && (
          <Button
            type="primary" size="small" icon={<PlusOutlined />}
            onClick={() => setLogOpen(true)}
          >
            Log transaction
          </Button>
        )}
      </Space>

      <div>
        <Title level={5}>Budgets and upcoming transactions</Title>
        <Table<GridRow>
          size="small" rowKey="key" pagination={false} dataSource={budgetRows}
          locale={{ emptyText: 'No budgets' }}
          expandable={{ defaultExpandAllRows: true, indentSize: 20 }}
          columns={[
            {
              title: 'Name', key: 'name',
              render: (_: unknown, row) => (isTxRow(row) ? nameCell(row.tx) : <Text strong>{row.name}</Text>),
            },
            { title: 'Planned', key: 'date', width: 110, render: (_: unknown, row) => (isTxRow(row) ? fmtDate(row.tx.plannedDate) : null) },
            { title: 'Accounts', key: 'accounts', width: 220, render: (_: unknown, row) => (isTxRow(row) ? accountsCell(row.tx) : null) },
            { title: 'Budget', key: 'envelope', align: 'right', width: 130, render: (_: unknown, row) => (isTxRow(row) ? null : fmt(row.envelope)) },
            {
              title: 'Executed', key: 'executed', align: 'right', width: 130,
              render: (_: unknown, row) => (isTxRow(row) ? null : <span style={{ color: amountColor(row.executed) }}>{fmt(row.executed)}</span>),
            },
            {
              title: 'Upcoming', key: 'pending', align: 'right', width: 130,
              render: (_: unknown, row) => {
                if (!isTxRow(row)) return <span style={{ color: amountColor(row.pending) }}>{fmt(row.pending)}</span>
                const t = row.tx
                return <span style={{ color: amountColor((t.plannedAmount ?? 0) * direction(t.from, t.to)) }}>{fmt(t.plannedAmount)}</span>
              },
            },
            {
              title: '', key: 'actions', width: 60, align: 'right',
              render: (_: unknown, row) => (isTxRow(row) ? <RowActions actions={actionsFor(txContext(row.tx))} /> : null),
            },
          ]}
        />
      </div>
      <div>
        <Title level={5}>Executed transactions</Title>
        <Table<Tx>
          size="small" rowKey="id" pagination={{ pageSize: 20, hideOnSinglePage: true }} dataSource={executed}
          locale={{ emptyText: 'No executed transactions' }}
          onRow={(t) => ({ onClick: () => void actionsFor(txContext(t)).find((a) => a.key === 'editExecuted')?.onClick(), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Executed', key: 'date', width: 110, render: (_: unknown, t) => fmtDate(t.executedOn) },
            { title: 'Name', key: 'name', render: (_: unknown, t) => nameCell(t) },
            { title: 'Budget', dataIndex: 'budgetName', width: 150 },
            { title: 'Accounts', key: 'accounts', width: 220, render: (_: unknown, t) => accountsCell(t) },
            {
              title: 'Amount', key: 'amount', align: 'right', width: 120,
              render: (_: unknown, t) => <span style={{ color: amountColor((t.amount ?? 0) * direction(t.from, t.to)) }}>{fmt(t.amount)}</span>,
            },
            {
              title: '', key: 'actions', width: 60, align: 'right',
              render: (_: unknown, t) => <RowActions actions={actionsFor(txContext(t))} />,
            },
          ]}
        />
      </div>

      {modals}
      <LogTransactionModal open={logOpen} planId={plan.id} onClose={() => setLogOpen(false)} onLogged={() => { void load() }} />
    </Space>
  )
}
