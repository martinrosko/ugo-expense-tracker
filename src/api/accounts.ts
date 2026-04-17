import rescoClient from './rescoClient'
import type { RwAccount } from '../types/resco'
import { AccountType } from '../types/resco'

const SELECT = 'rw_accountid,name,rw_accounttype,rw_isdefault'

export async function fetchAccounts(): Promise<RwAccount[]> {
  const res = await rescoClient.get<{ value: RwAccount[] }>('/rw_accounts', {
    params: { $select: SELECT, $filter: 'statecode eq 0' },
  })
  return res.data.value
}

/** Returns only accounts the user owns (cash, bank, investment) — not partners. */
export async function fetchUserAccounts(): Promise<RwAccount[]> {
  const res = await rescoClient.get<{ value: RwAccount[] }>('/rw_accounts', {
    params: {
      $select: SELECT,
      $filter: `statecode eq 0 and rw_accounttype ne ${AccountType.PaymentPartner}`,
    },
  })
  return res.data.value
}

/** Returns payment partner accounts (counterparties in transactions). */
export async function fetchPaymentPartners(): Promise<RwAccount[]> {
  const res = await rescoClient.get<{ value: RwAccount[] }>('/rw_accounts', {
    params: {
      $select: SELECT,
      $filter: `statecode eq 0 and rw_accounttype eq ${AccountType.PaymentPartner}`,
    },
  })
  return res.data.value
}
