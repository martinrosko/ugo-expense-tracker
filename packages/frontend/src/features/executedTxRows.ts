import type { ExecutedTxRow } from '../components/ExecutedTransactionsTable'
import type { TxActionContext } from './usePlanTxActions'

/** An executed transaction as returned by GET /api/transactions */
export type ApiTx = {
  id: string
  name: string | null
  amount: string | null
  executedOn: string | null
  templateId?: string | null
  bankTicketId?: string | null
  /** Unset means editable */
  canEdit?: boolean
  bankTicket?: { executedOn: string } | null
  fromAccount?: { name: string; type: string } | null
  toAccount?: { name: string; type: string } | null
  plan?: { id: string; name: string | null; statusCode: number; template?: { name: string | null } | null } | null
  budget?: { name: string | null; statusCode: number; template?: { name: string | null } | null; plan?: { id: string; name: string | null; statusCode: number; template?: { name: string | null } | null } | null } | null
  tags?: { tag: { id: string; name: string; color?: string | null } }[]
}

const ASSET_TYPES = new Set(['CASH', 'BANK', 'INVESTMENT'])

function kindOf(tx: ApiTx): ExecutedTxRow['kind'] {
  const from = ASSET_TYPES.has(tx.fromAccount?.type ?? '')
  const to = ASSET_TYPES.has(tx.toAccount?.type ?? '')
  if (from && to) return 'transfer'
  return to ? 'income' : 'expense'
}

export function toRow(t: ApiTx): ExecutedTxRow {
  return {
    id: t.id,
    executedOn: t.executedOn,
    name: t.name,
    hasTemplate: !!t.templateId,
    hasBankTicket: !!t.bankTicketId,
    ticketOn: t.bankTicket?.executedOn,
    from: t.fromAccount?.name,
    to: t.toAccount?.name,
    plan: (t.plan ?? t.budget?.plan)?.name ?? (t.plan ?? t.budget?.plan)?.template?.name,
    budget: t.budget?.name ?? t.budget?.template?.name,
    amount: t.amount ? parseFloat(t.amount) : null,
    kind: kindOf(t),
    tags: (t.tags ?? []).map((x) => x.tag),
  }
}

export function actionContext(tx: ApiTx): TxActionContext | null {
  const plan = tx.plan ?? tx.budget?.plan
  if (!plan) return null
  return { id: tx.id, planId: plan.id, planStatus: plan.statusCode, budgetCompleted: tx.budget?.statusCode === 3, templateId: tx.templateId ?? null, executed: true, readOnly: tx.canEdit === false }
}
