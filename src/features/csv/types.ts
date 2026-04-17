export interface BankTransaction {
  date: string        // ISO date string
  description: string
  amount: number      // negative = expense, positive = income
  currency: string
}
