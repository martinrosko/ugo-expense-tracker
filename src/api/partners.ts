import rescoClient from './rescoClient'
import type { PaymentPartner } from '../types/resco'

export async function fetchPartners(): Promise<PaymentPartner[]> {
  const response = await rescoClient.get<{ value: PaymentPartner[] }>('/PaymentPartners')
  return response.data.value
}
