import { useState, type ReactNode } from 'react'
import { App } from 'antd'
import { CheckOutlined, DeleteOutlined, EditOutlined, UndoOutlined } from '@ant-design/icons'
import apiClient from '../api/apiClient'
import TransactionModal, { type TxModalBody, type TxModalTx } from '../components/TransactionModal'
import type { RowAction } from '../components/RowActions'
import { apiError, num, resolveAll, type Account, type RawPlan, type Tx } from './planTransactions'

/** What the action rules need to know about a transaction row */
export type TxActionContext = {
  id: string
  planId: string
  planStatus: number
  budgetCompleted: boolean
  templateId: string | null
  executed: boolean
}

type Target = { kind: 'execute' | 'edit' | 'editExecuted'; plan: RawPlan; tx: Tx; accounts: Account[] }

function modalTx(t: Tx, amount: number | null): TxModalTx {
  return {
    name: t.raw.name ?? t.raw.template?.name ?? null,
    plannedAmount: amount !== null ? String(amount) : null,
    fromAccountId: t.from?.id ?? null,
    toAccountId: t.to?.id ?? null,
    fromAccount: t.from,
    toAccount: t.to,
    dueDateConfig: t.dueDateConfig,
    executedOn: t.raw.executedOn,
  }
}

// Only changed fields become overrides; untouched ones keep inheriting from the template
const changed = <T,>(next: T | null, current: T | null) => (next !== null && next !== current ? next : undefined)

/**
 * Row actions for planned and executed transactions: execute, change planned values, edit an executed
 * transaction, discard an execution, delete. `modals` must be rendered once by the caller.
 */
export function usePlanTxActions(onChanged: () => void | Promise<unknown>) {
  const { message: messageApi } = App.useApp()
  const [target, setTarget] = useState<Target | null>(null)
  const [busy, setBusy] = useState(false)

  async function perform(action: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(true)
    try {
      await action()
      messageApi.success(success)
      await onChanged()
      return true
    } catch (err) {
      messageApi.error(apiError(err, 'Action failed'))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function open(kind: Target['kind'], ctx: TxActionContext) {
    setBusy(true)
    try {
      const [planRes, accountsRes] = await Promise.all([
        apiClient.get<RawPlan>(`/api/plans/${ctx.planId}`),
        apiClient.get<Account[]>('/api/accounts'),
      ])
      const tx = resolveAll(planRes.data, new Map(accountsRes.data.map((a) => [a.id, a]))).find((t) => t.id === ctx.id)
      if (!tx) throw new Error('Transaction not found')
      setTarget({ kind, plan: planRes.data, tx, accounts: accountsRes.data })
    } catch (err) {
      messageApi.error(apiError(err, 'Failed to load transaction'))
    } finally {
      setBusy(false)
    }
  }

  function actionsFor(ctx: TxActionContext): RowAction[] {
    const active = ctx.planStatus === 1
    const completed = ctx.planStatus === 3
    // Template transactions of active plans are discarded; anything in completed plans or budgets can be deleted
    const canDelete = completed || ctx.budgetCompleted || !ctx.templateId
    const canDiscard = active && !ctx.budgetCompleted && ctx.templateId !== null && ctx.executed
    const del: RowAction = {
      key: 'delete', label: 'Delete', icon: <DeleteOutlined />, danger: true, disabled: busy,
      confirm: { title: 'Delete this transaction?', okText: 'Delete' },
      onClick: () => perform(() => apiClient.delete(`/api/transactions/${ctx.id}`), 'Transaction deleted'),
    }
    return [
      ...(!ctx.executed && active && !ctx.budgetCompleted
        ? [
          { key: 'execute', label: 'Execute', icon: <CheckOutlined />, disabled: busy, onClick: () => open('execute', ctx) },
          { key: 'edit', label: 'Change planned values', icon: <EditOutlined />, disabled: busy, onClick: () => open('edit', ctx) },
        ]
        : []),
      ...(ctx.executed && (active || completed)
        ? [{ key: 'editExecuted', label: 'Edit executed transaction', icon: <EditOutlined />, disabled: busy, onClick: () => open('editExecuted', ctx) }]
        : []),
      ...(canDiscard
        ? [{
          key: 'discard', label: 'Discard execution', icon: <UndoOutlined />, disabled: busy,
          confirm: { title: 'Discard this execution?', description: 'The transaction goes back to planned.', okText: 'Discard' },
          onClick: () => perform(() => apiClient.post(`/api/transactions/${ctx.id}/unexecute`), 'Execution discarded'),
        }]
        : []),
      ...(!canDiscard && canDelete ? [del] : []),
    ]
  }

  async function submitExecute(body: TxModalBody) {
    const { tx } = target!
    const ok = await perform(
      () => apiClient.post(`/api/transactions/${tx.id}/execute`, {
        executedOn: body.executedOn,
        amount: body.plannedAmount,
        name: changed(body.name, tx.name),
        fromAccountId: changed(body.fromAccountId, tx.from?.id ?? null),
        toAccountId: changed(body.toAccountId, tx.to?.id ?? null),
      }),
      'Transaction executed',
    )
    if (ok) setTarget(null)
  }

  async function submitEdit(body: TxModalBody) {
    const { tx } = target!
    const ok = await perform(
      () => apiClient.patch(`/api/transactions/${tx.id}`, {
        name: changed(body.name, tx.name),
        plannedAmount: num(body.plannedAmount) !== tx.plannedAmount ? body.plannedAmount ?? undefined : undefined,
        fromAccountId: changed(body.fromAccountId, tx.from?.id ?? null),
        toAccountId: changed(body.toAccountId, tx.to?.id ?? null),
        dueDateConfig: changed(body.dueDateConfig, tx.dueDateConfig),
      }),
      'Planned values updated',
    )
    if (ok) setTarget(null)
  }

  async function submitEditExecuted(body: TxModalBody) {
    const { tx } = target!
    const ok = await perform(
      () => apiClient.patch(`/api/transactions/${tx.id}`, {
        amount: body.plannedAmount,
        executedOn: body.executedOn,
        name: changed(body.name, tx.name),
        fromAccountId: changed(body.fromAccountId, tx.from?.id ?? null),
        toAccountId: changed(body.toAccountId, tx.to?.id ?? null),
      }),
      'Transaction updated',
    )
    if (ok) setTarget(null)
  }

  const close = () => setTarget(null)
  const forKind = (kind: Target['kind']) => (target?.kind === kind ? target : null)
  const executeTarget = forKind('execute')
  const editTarget = forKind('edit')
  const executedTarget = forKind('editExecuted')

  const modals: ReactNode = (
    <>
      <TransactionModal
        mode="execute" open={executeTarget !== null}
        tx={executeTarget ? modalTx(executeTarget.tx, executeTarget.tx.plannedAmount) : null}
        accounts={executeTarget?.accounts ?? []} planIntervalType={executeTarget?.plan.intervalType ?? 'ONE_TIME'}
        onOk={submitExecute} onCancel={close}
      />
      <TransactionModal
        open={editTarget !== null} tx={editTarget ? modalTx(editTarget.tx, editTarget.tx.plannedAmount) : null}
        accounts={editTarget?.accounts ?? []} planIntervalType={editTarget?.plan.intervalType ?? 'ONE_TIME'}
        onOk={submitEdit} onCancel={close}
      />
      <TransactionModal
        mode="execute" open={executedTarget !== null}
        tx={executedTarget ? modalTx(executedTarget.tx, executedTarget.tx.amount) : null}
        accounts={executedTarget?.accounts ?? []} planIntervalType={executedTarget?.plan.intervalType ?? 'ONE_TIME'}
        title="Edit Executed Transaction" okText="Save" onOk={submitEditExecuted} onCancel={close}
      />
    </>
  )

  return { actionsFor, modals }
}
