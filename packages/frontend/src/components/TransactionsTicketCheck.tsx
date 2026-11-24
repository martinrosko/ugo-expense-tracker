import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Spin } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import apiClient from '../api/apiClient'
import { apiError } from '../features/planTransactions'
import { usePlanTxActions } from '../features/usePlanTxActions'
import { actionContext, toRow, type ApiTx } from '../features/executedTxRows'
import ExecutedTransactionsTable from './ExecutedTransactionsTable'

/** Linked to a bank ticket of another calendar day than its own execution date */
const dayDiffers = (t: ApiTx) => !!t.bankTicket && !!t.executedOn && dayjs(t.executedOn).format('YYYY-MM-DD') !== dayjs(t.bankTicket.executedOn).format('YYYY-MM-DD')

/**
 * Executed transactions of a bank account (within a date range) that need attention:
 * without a linked bank ticket, or executed on another day than their ticket.
 */
export default function TransactionsTicketCheck({ accountId, range, check }: { accountId?: string; range: [Dayjs, Dayjs] | null; check: 'noTicket' | 'dateMismatch' }) {
  const [txs, setTxs] = useState<ApiTx[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const lastFetchKey = useRef('')
  const { actionsFor, modals } = usePlanTxActions(() => setReloadKey((k) => k + 1))

  const from = range?.[0].format('YYYY-MM-DD')
  const to = range?.[1].format('YYYY-MM-DD')

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    // Only a changed filter shows the spinner; a reload after an edit keeps the table state
    const fetchKey = `${accountId}|${from}|${to}|${check}`
    if (fetchKey !== lastFetchKey.current) setLoading(true)
    lastFetchKey.current = fetchKey
    setError(null)
    apiClient.get<ApiTx[]>('/api/transactions', { params: { executed: 'true', ...(check === 'noTicket' ? { unmatched: 'true' } : {}), accountId, from, to } })
      .then((res) => { if (!cancelled) setTxs(check === 'noTicket' ? res.data : res.data.filter(dayDiffers)) })
      .catch((err) => { if (!cancelled) setError(apiError(err, 'Failed to load transactions')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, from, to, check, reloadKey])

  const byId = useMemo(() => new Map(txs.map((t) => [t.id, t])), [txs])
  const rows = useMemo(() => txs.map(toRow), [txs])

  if (!accountId) return <Alert type="info" showIcon title="Select a bank account." />
  if (loading) return <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>
  if (error) return <Alert type="error" showIcon title={error} />

  return (
    <>
      <ExecutedTransactionsTable
        rows={rows}
        scope="planAndBudget"
        showTags
        defaultPageSize={50}
        pageSizeOptions={[20, 50, 100, 200]}
        resetKey={`${accountId}|${from}|${to}|${check}`}
        emptyText={check === 'noTicket' ? 'Every executed transaction in this range has a bank ticket.' : 'Every transaction in this range was executed on the day of its bank ticket.'}
        actionsFor={(row) => {
          const ctx = byId.has(row.id) ? actionContext(byId.get(row.id)!) : null
          return ctx ? actionsFor(ctx) : []
        }}
      />
      {modals}
    </>
  )
}
