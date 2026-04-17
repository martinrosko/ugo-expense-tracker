import rescoClient from './rescoClient'
import type { Budget } from '../types/resco'

export async function fetchBudgets(): Promise<Budget[]> {
  const response = await rescoClient.get<{ value: Budget[] }>('/Budgets')
  return response.data.value
}
