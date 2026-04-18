import rescoClient from './rescoClient'
import type { RwBudget } from '../types/resco'

const SELECT = 'id,name,rw_amount,__rw_parentid_id,__rw_defaultaccountid_id'

/** Fetches active budgets, optionally filtered to specific parent plan IDs. */
export async function fetchBudgets(planIds?: string[]): Promise<RwBudget[]> {
  const parentFilter =
    planIds && planIds.length > 0
      ? ` and (${planIds.map((id) => `__rw_parentid_id eq ${id}`).join(' or ')})`
      : ''
  const res = await rescoClient.get<{ value: RwBudget[] }>('/rw_budget', {
    params: { $select: SELECT, $filter: `statecode eq 0${parentFilter}` },
  })
  return res.data.value
}
