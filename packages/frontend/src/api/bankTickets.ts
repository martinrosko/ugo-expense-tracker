import rescoClient from './rescoClient'
import type { RwBankTicket } from '../types/resco'

/** Returns true if a bank ticket with this bank-issued ID already exists (deduplication). */
export async function checkDuplicateBankTicket(ticketId: string): Promise<boolean> {
  const res = await rescoClient.get<{ value: RwBankTicket[] }>('/rw_bankticket', {
    params: {
      $select: 'id',
      $filter: `rw_ticketid eq '${ticketId}'`,
      $top: 1,
    },
  })
  return res.data.value.length > 0
}

export async function createBankTicket(
  ticket: Omit<RwBankTicket, 'id' | '_rw_accountid_value'> & {
    accountId?: string
  },
): Promise<RwBankTicket> {
  const { accountId, ...fields } = ticket
  const body: Record<string, unknown> = { ...fields }
  if (accountId) {
    body['rw_accountid@odata.bind'] = `/rw_account(${accountId})`
  }
  const res = await rescoClient.post<RwBankTicket>('/rw_bankticket', body)
  return res.data
}
