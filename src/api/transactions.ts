import rescoClient from './rescoClient'
import type { RescoTransaction } from '../types/resco'

export async function createTransaction(tx: RescoTransaction): Promise<RescoTransaction> {
  const response = await rescoClient.post<RescoTransaction>('/Transactions', tx)
  return response.data
}

export async function updateTransaction(id: string, tx: Partial<RescoTransaction>): Promise<void> {
  await rescoClient.patch(`/Transactions(${id})`, tx)
}
