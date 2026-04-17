import rescoClient from './rescoClient'
import type { RwBudget } from '../types/resco'

const SELECT = 'rw_budgetid,name,rw_amount,_rw_parentid_value,_rw_defaultaccountid_value'

/** Fetches active budgets, optionally filtered to specific parent plan IDs. */
export async function fetchBudgets(planIds?: string[]): Promise<RwBudget[]> {
  const parentFilter =
    planIds && planIds.length > 0
      ? ` and (${planIds.map((id) => `_rw_parentid_value eq ${id}`).join(' or ')})`
      : ''
  const res = await rescoClient.get<{ value: RwBudget[] }>('/rw_budgets', {
    params: { $select: SELECT, $filter: `statecode eq 0${parentFilter}` },
  })
  return res.data.value
}
