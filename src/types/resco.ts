// Placeholder types — to be updated once the Resco Cloud schema is confirmed.

export interface PaymentPartner {
  id: string
  name: string
}

export interface Budget {
  id: string
  name: string
  startDate: string // ISO date
  endDate: string   // ISO date
}

export interface Tag {
  id: string
  name: string
}

export interface RescoTransaction {
  id?: string
  date: string        // ISO date
  description: string
  amount: number
  currency: string
  partnerId?: string
  budgetId?: string
  tagIds?: string[]
}
