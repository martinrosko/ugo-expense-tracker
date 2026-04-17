import rescoClient from './rescoClient'
import type { RwTag } from '../types/resco'

export async function fetchTags(): Promise<RwTag[]> {
  const res = await rescoClient.get<{ value: RwTag[] }>('/rw_tags', {
    params: { $select: 'rw_tagid,name,rw_color' },
  })
  return res.data.value
}

export async function createTransactionTag(
  transactionId: string,
  tagId: string,
  amount?: number,
): Promise<void> {
  const body: Record<string, unknown> = {
    'rw_transactionid@odata.bind': `/rw_transactions(${transactionId})`,
    'rw_tagid@odata.bind': `/rw_tags(${tagId})`,
  }
  if (amount !== undefined) body.rw_amount = amount
  await rescoClient.post('/rw_transactiontags', body)
}
