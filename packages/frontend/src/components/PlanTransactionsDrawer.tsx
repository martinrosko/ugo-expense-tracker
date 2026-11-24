import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Drawer, Spin, Tooltip } from 'antd'
import { FullscreenOutlined } from '@ant-design/icons'
import apiClient from '../api/apiClient'
import { apiError } from '../features/planTransactions'
import { usePlanTxActions, type TxActionContext } from '../features/usePlanTxActions'
import ExecutedTransactionsTable, { type ExecutedTxRow } from './ExecutedTransactionsTable'

/** What the panel lists: the executed transactions of a plan or of one budget. */
export type TransactionsScope = {
  title: string
  planId?: string
  budgetId?: string
  /** Query of the transactions page that shows the same list */
  qs: string
}

type ApiTx = {
  id: string
  name: string | null
  amount: string | null
  executedOn: string | null
  templateId?: string | null
  bankTicketId?: string | null
  fromAccount?: { name: string; type: string } | null
  toAccount?: { name: string; type: string } | null
  plan?: { id: string; name: string | null; statusCode: number } | null
  budget?: { name: string | null; statusCode: number; plan?: { id: string; statusCode: number } | null } | null
  tags?: { tag: { id: string; name: string; color?: string | null } }[]
}

const ASSET_TYPES = new Set(['CASH', 'BANK', 'INVESTMENT'])

function kindOf(tx: ApiTx): ExecutedTxRow['kind'] {
  const from = ASSET_TYPES.has(tx.fromAccount?.type ?? '')
  const to = ASSET_TYPES.has(tx.toAccount?.type ?? '')
  if (from && to) return 'transfer'
  return to ? 'income' : 'expense'
}

function actionContext(tx: ApiTx): TxActionContext | null {
  const plan = tx.plan ?? tx.budget?.plan
  if (!plan) return null
  return { id: tx.id, planId: plan.id, planStatus: plan.statusCode, budgetCompleted: tx.budget?.statusCode === 3, templateId: tx.templateId ?? null, executed: true }
}

/**
 * Side panel over the page with the executed transactions of a plan or budget. It lists them like the transactions page
 * (tags, row click and actions to edit or delete); the full page with the same filter is one click away.
 */
export default function PlanTransactionsDrawer({ scope, onClose, onChanged }: { scope: TransactionsScope | null; onClose: () => void; onChanged?: () => void }) {
  const navigate = useNavigate()
  const [txs, setTxs] = useState<ApiTx[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const { actionsFor, modals } = usePlanTxActions(() => {
    setReloadKey((k) => k + 1)
    onChanged?.()
  })

  useEffect(() => {
    if (!scope) return
    let cancelled = false
    setLoading(true)
    setError(null)
    apiClient.get<ApiTx[]>('/api/transactions', { params: { executed: 'true', planId: scope.planId, budgetId: scope.budgetId } })
      .then((res) => { if (!cancelled) setTxs(res.data) })
      .catch((err) => { if (!cancelled) setError(apiError(err, 'Failed to load transactions')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [scope, reloadKey])

  const byId = useMemo(() => new Map(txs.map((t) => [t.id, t])), [txs])
  const rows = useMemo<ExecutedTxRow[]>(() => txs.map((t) => ({
    id: t.id,
    executedOn: t.executedOn,
    name: t.name,
    hasTemplate: !!t.templateId,
    hasBankTicket: !!t.bankTicketId,
    from: t.fromAccount?.name,
    to: t.toAccount?.name,
    plan: t.plan?.name,
    budget: t.budget?.name,
    amount: t.amount ? parseFloat(t.amount) : null,
    kind: kindOf(t),
    tags: (t.tags ?? []).map((x) => x.tag),
  })), [txs])

  function maximize() {
    if (!scope) return
    onClose()
    navigate(`/transactions?${scope.qs}`)
  }

  return (
    <>
      <Drawer
        open={scope !== null}
        title={scope ? `Transactions \u00b7 ${scope.title}` : ''}
        onClose={onClose}
        size={900}
        resizable
        // Floats over the page: no dimming, so the plans stay visible and usable behind it
        mask={false}
        destroyOnHidden
        extra={(
          <Tooltip title="Open on the transactions page">
            <Button type="text" icon={<FullscreenOutlined />} onClick={maximize} />
          </Tooltip>
        )}
      >
        {loading && <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>}
        {error && <Alert type="error" title={error} showIcon />}
        {!loading && !error && (
          <ExecutedTransactionsTable
            rows={rows}
            // The budget is only shown where it varies
            scope={scope?.budgetId ? undefined : 'budget'}
            showTags
            defaultPageSize={50}
            pageSizeOptions={[20, 50, 100, 200]}
            emptyText="No executed transactions found."
            actionsFor={(row) => {
              const ctx = byId.has(row.id) ? actionContext(byId.get(row.id)!) : null
              return ctx ? actionsFor(ctx) : []
            }}
          />
        )}
      </Drawer>
      {modals}
    </>
  )
}
