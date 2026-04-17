import Papa from 'papaparse'
import type { BankTransaction } from './types'

// Column mapping for the bank CSV export.
// Update field names here when the actual CSV headers are confirmed.
const COLUMN_MAP = {
  date: 'Date',
  description: 'Description',
  amount: 'Amount',
  currency: 'Currency',
}

export function parseCSV(file: File): Promise<BankTransaction[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        try {
          const transactions: BankTransaction[] = results.data.map((row) => ({
            date: row[COLUMN_MAP.date]?.trim() ?? '',
            description: row[COLUMN_MAP.description]?.trim() ?? '',
            amount: parseFloat(row[COLUMN_MAP.amount]?.replace(',', '.') ?? '0'),
            currency: row[COLUMN_MAP.currency]?.trim() ?? 'EUR',
          }))
          resolve(transactions)
        } catch (err) {
          reject(err)
        }
      },
      error(err) {
        reject(err)
      },
    })
  })
}
