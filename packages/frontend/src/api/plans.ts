import rescoClient from './rescoClient'
import type { RwPlan } from '../types/resco'

const SELECT = 'id,name,rw_startdate,rw_enddate,rw_intervaltype,rw_istemplate'

/** Fetches non-template plans that are currently active (date range covers today). */
export async function fetchActivePlans(): Promise<RwPlan[]> {
  const today = new Date().toISOString()
  const res = await rescoClient.get<{ value: RwPlan[] }>('/rw_plan', {
    params: {
      $select: SELECT,
      $filter: [
        'statecode eq 0',
        'rw_istemplate eq false',
        `rw_startdate le ${today}`,
        `rw_enddate ge ${today}`,
      ].join(' and '),
    },
  })
  return res.data.value
}
