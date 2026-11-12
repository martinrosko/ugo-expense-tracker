import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Select, Space, Spin, Typography } from 'antd'
import apiClient from '../api/apiClient'
import TransactionModal, { type TxModalBody, type TxModalTx } from './TransactionModal'
import { planLabel } from '../features/planLabel'
import {
  apiError, byExecutedNewestFirst, byPlannedDate, resolveAll,
  type Account, type RawPlan, type Tx,
} from '../features/planTransactions'

const { Text } = Typography

type PlanOption = {
  id: string
  name: string | null
  startDate: string | null
  endDate: string | null
  intervalType: string
  templateIntervalType?: string | null
  isTemplate: boolean
  statusCode: number
}

const NEW = 'new'

const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString('sk-SK') : 'no date')
const fmtAmount = (v: number | null) => (v === null ? '' : ` · ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`)

// Only changed fields become overrides; untouched ones keep inheriting from the template
const changed = <T,>(next: T | null, current: T | null) => (next !== null && next !== current ? next : undefined)

function modalTx(t: Tx, amount: number | null): TxModalTx {
  return {
    name: t.raw.name ?? t.raw.template?.name ?? null,
    plannedAmount: amount !== null ? String(amount) : null,
    fromAccountId: t.from?.id ?? null,
    toAccountId: t.to?.id ?? null,
    fromAccount: t.from,
    toAccount: t.to,
    dueDateConfig: null,
    budgetId: t.budgetId,
  }
}

type Props = {
  open: boolean
  /** Fixes the plan and hides the plan picker */
  planId?: string
  /** Limits the dialog to one budget of the plan; null means the plan's general (no-budget) transactions */
  budgetId?: string | null
  onClose: () => void
  onLogged: () => void
}

/**
 * Logs a transaction into an active or completed plan: executes a planned one, or records an unplanned one
 * (optionally copied from an already executed transaction).
 */
export default function LogTransactionModal({ open, planId, budgetId, onClose, onLogged }: Props) {
  const { message: messageApi } = App.useApp()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [planOptions, setPlanOptions] = useState<PlanOption[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [plan, setPlan] = useState<RawPlan | null>(null)
  const [loadingPlan, setLoadingPlan] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txKey, setTxKey] = useState<string>(NEW)

  useEffect(() => {
    if (!open) return
    setSelectedPlanId(planId ?? null)
    setPlan(null)
    setTxKey(NEW)
    setError(null)
    let cancelled = false
    apiClient.get<Account[]>('/api/accounts').then((res) => { if (!cancelled) setAccounts(res.data) }).catch(() => undefined)
    if (!planId) {
      Promise.all([
        apiClient.get<PlanOption[]>('/api/plans', { params: { status: '1', isTemplate: 'false' } }),
        apiClient.get<PlanOption[]>('/api/plans', { params: { status: '3', isTemplate: 'false' } }),
      ])
        .then(([active, completed]) => { if (!cancelled) setPlanOptions([...active.data, ...completed.data]) })
        .catch((err) => { if (!cancelled) setError(apiError(err, 'Failed to load plans')) })
    }
    return () => { cancelled = true }
  }, [open, planId])

  useEffect(() => {
    if (!open || !selectedPlanId) return
    let cancelled = false
    setLoadingPlan(true)
    setTxKey(NEW)
    apiClient.get<RawPlan>(`/api/plans/${selectedPlanId}`)
      .then((res) => { if (!cancelled) setPlan(res.data) })
      .catch((err) => { if (!cancelled) setError(apiError(err, 'Failed to load plan')) })
      .finally(() => { if (!cancelled) setLoadingPlan(false) })
    return () => { cancelled = true }
  }, [open, selectedPlanId])

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const txs = useMemo(
    () => (plan ? resolveAll(plan, accountMap).filter((t) => budgetId === undefined || t.budgetId === budgetId) : []),
    [plan, accountMap, budgetId],
  )
  const active = plan?.statusCode === 1
  const completed = plan?.statusCode === 3
  const planned = useMemo(() => (active ? txs.filter((t) => !t.executedOn && !t.budgetCompleted).sort(byPlannedDate) : []), [txs, active])
  const executed = useMemo(() => txs.filter((t) => t.executedOn).sort(byExecutedNewestFirst), [txs])
  const selected = txKey === NEW ? null : txs.find((t) => t.id === txKey) ?? null
  const executing = selected !== null && !selected.executedOn

  // Active plans first (oldest first), then completed ones (newest first)
  const planSelectOptions = useMemo(() => {
    const label = (p: PlanOption) => `${planLabel(p)}${p.startDate ? ` (${new Date(p.startDate).toLocaleDateString('sk-SK')})` : ''}`
    const byStart = (a: PlanOption, b: PlanOption) => (a.startDate ?? '').localeCompare(b.startDate ?? '')
    const activePlans = planOptions.filter((p) => p.statusCode === 1).sort(byStart)
    const completedPlans = planOptions.filter((p) => p.statusCode === 3).sort((a, b) => byStart(b, a))
    return [
      { label: 'Active', options: activePlans.map((p) => ({ value: p.id, label: label(p) })) },
      { label: 'Completed', options: completedPlans.map((p) => ({ value: p.id, label: label(p) })) },
    ].filter((g) => g.options.length > 0)
  }, [planOptions])

  const txSelectOptions = [
    { value: NEW, label: 'New transaction (not planned)' },
    ...(planned.length > 0 ? [{ label: 'Planned', options: planned.map((t) => ({ value: t.id, label: `${fmtDate(t.plannedDate)} · ${t.name}${fmtAmount(t.plannedAmount)}` })) }] : []),
    ...(executed.length > 0 ? [{ label: 'Executed (copy values)', options: executed.map((t) => ({ value: t.id, label: `${fmtDate(t.executedOn)} · ${t.name}${fmtAmount(t.amount)}` })) }] : []),
  ]

  const allBudgets = plan
    ? [{ value: null as string | null, label: 'General (no budget)' }, ...plan.budgets.map((b) => ({ value: b.id as string | null, label: b.name ?? b.template?.name ?? '(unnamed)' }))]
    : undefined
  const budgets = budgetId === undefined ? allBudgets : allBudgets?.filter((b) => b.value === budgetId)

  const extra = (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      {error && <Alert type="error" message={error} showIcon />}
      {!planId && (
        <div>
          <Text strong>Plan</Text>
          <Select
            showSearch optionFilterProp="label" placeholder="Select a plan…" style={{ width: '100%', marginTop: 4 }}
            options={planSelectOptions} value={selectedPlanId ?? undefined} onChange={setSelectedPlanId}
          />
        </div>
      )}
      {loadingPlan && <Spin size="small" />}
      {plan && !loadingPlan && (
        <div>
          <Text strong>Transaction</Text>
          <Select
            showSearch optionFilterProp="label" style={{ width: '100%', marginTop: 4 }}
            options={txSelectOptions} value={txKey} onChange={setTxKey}
          />
        </div>
      )}
    </Space>
  )

  async function submit(body: TxModalBody) {
    if (!plan) return
    try {
      if (selected && executing) {
        await apiClient.post(`/api/transactions/${selected.id}/execute`, {
          executedOn: body.executedOn,
          amount: body.plannedAmount,
          name: changed(body.name, selected.name),
          fromAccountId: changed(body.fromAccountId, selected.from?.id ?? null),
          toAccountId: changed(body.toAccountId, selected.to?.id ?? null),
        })
      } else {
        await apiClient.post('/api/transactions', {
          name: body.name,
          amount: body.plannedAmount,
          executedOn: body.executedOn,
          type: 'TRANSACTION',
          fromAccountId: body.fromAccountId,
          toAccountId: body.toAccountId,
          budgetId: body.budgetId,
          planId: body.budgetId ? null : plan.id,
          statusCode: completed ? 3 : 1,
          stateCode: completed ? 1 : 0,
        })
      }
    } catch (err) {
      messageApi.error(apiError(err, 'Failed to log transaction'))
      return
    }
    messageApi.success(executing ? 'Transaction executed' : 'Transaction logged')
    onLogged()
    onClose()
  }

  return (
    <TransactionModal
      mode="execute"
      open={open}
      tx={selected ? modalTx(selected, selected.executedOn ? selected.amount : selected.plannedAmount) : null}
      accounts={accounts}
      planIntervalType={plan?.intervalType ?? 'ONE_TIME'}
      budgets={budgets}
      budgetLocked={executing || budgetId !== undefined}
      initialBudgetId={budgetId}
      extra={extra}
      resetKey={`${selectedPlanId}:${txKey}:${budgetId}`}
      title={executing ? 'Execute Transaction' : 'Log Transaction'}
      okText={executing ? 'Execute' : 'Log'}
      okDisabled={!plan || loadingPlan}
      onOk={submit}
      onCancel={onClose}
    />
  )
}
