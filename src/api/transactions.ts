import rescoClient from './rescoClient'
import type { RwTransaction } from '../types/resco'

const SELECT =
  'rw_transactionid,name,rw_amount,rw_plannedamount,rw_plannedon,_rw_bankticketid_value,_rw_parentid_value,_rw_parentid_value@Microsoft.Dynamics.CRM.lookuplogicalname,_rw_fromaccountid_value,_rw_toaccountid_value,rw_type'

/**
 * Fetches active planned transactions that have not yet been matched to a bank ticket.
 * Optionally scoped to given parent plan/budget IDs.
 */
export async function fetchUnmatchedTransactions(
  parentIds?: string[],
): Promise<RwTransaction[]> {
  const parentFilter =
    parentIds && parentIds.length > 0
      ? ` and (${parentIds.map((id) => `_rw_parentid_value eq ${id}`).join(' or ')})`
      : ''
  const res = await rescoClient.get<{ value: RwTransaction[] }>('/rw_transactions', {
    params: {
      $select: SELECT,
      $filter: `statecode eq 0 and _rw_bankticketid_value eq null${parentFilter}`,
    },
  })
  return res.data.value
}

/** Links an existing planned transaction to a confirmed bank ticket. */
export async function linkBankTicketToTransaction(
  transactionId: string,
  bankTicketId: string,
  executedOn: string,
): Promise<void> {
  await rescoClient.patch(`/rw_transactions(${transactionId})`, {
    'rw_bankticketid@odata.bind': `/rw_banktickets(${bankTicketId})`,
    rw_executedon: executedOn,
  })
}

/** Creates a new realized transaction linked to a bank ticket and a budget. */
export async function createTransaction(params: {
  name: string
  rw_amount: number
  rw_executedon: string
  bankTicketId: string
  budgetId: string
  fromAccountId?: string
  toAccountId?: string
  rw_type?: number
}): Promise<RwTransaction> {
  const body: Record<string, unknown> = {
    name: params.name,
    rw_amount: params.rw_amount,
    rw_executedon: params.rw_executedon,
    rw_type: params.rw_type ?? 1,
    'rw_bankticketid@odata.bind': `/rw_banktickets(${params.bankTicketId})`,
    'rw_parentid@odata.bind': `/rw_budgets(${params.budgetId})`,
  }
  if (params.fromAccountId)
    body['rw_fromaccountid@odata.bind'] = `/rw_accounts(${params.fromAccountId})`
  if (params.toAccountId)
    body['rw_toaccountid@odata.bind'] = `/rw_accounts(${params.toAccountId})`
  const res = await rescoClient.post<RwTransaction>('/rw_transactions', body)
  return res.data
}
