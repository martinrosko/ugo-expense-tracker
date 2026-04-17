import Papa from 'papaparse'
import type { CsvRow } from './types'

// ─── Column mapping ──────────────────────────────────────────────────────────
// These are PLACEHOLDER header names from a generic bank CSV export.
// UPDATE these values once you share a sample CSV from your specific bank.
const COLUMN_MAP: Record<keyof CsvRow, string> = {
  executedon: 'Date',
  amount: 'Amount',
  partnername: 'Partner Name',
  partneraccountnumber: 'Partner Account Number',
  reference: 'Reference',
  variablesymbol: 'Variable Symbol',
  constantsymbol: 'Constant Symbol',
  specificsymbol: 'Specific Symbol',
  ticketid: 'Transaction ID',
}

export function parseCSV(file: File): Promise<CsvRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        try {
          const rows: CsvRow[] = results.data.map((row) => ({
            executedon: row[COLUMN_MAP.executedon]?.trim() ?? '',
            amount: parseFloat(
              (row[COLUMN_MAP.amount] ?? '0').replace(/\s/g, '').replace(',', '.'),
            ),
            partnername: row[COLUMN_MAP.partnername]?.trim() ?? '',
            partneraccountnumber: row[COLUMN_MAP.partneraccountnumber]?.trim() ?? '',
            reference: row[COLUMN_MAP.reference]?.trim() ?? '',
            variablesymbol: row[COLUMN_MAP.variablesymbol]?.trim() ?? '',
            constantsymbol: row[COLUMN_MAP.constantsymbol]?.trim() ?? '',
            specificsymbol: row[COLUMN_MAP.specificsymbol]?.trim() ?? '',
            ticketid: row[COLUMN_MAP.ticketid]?.trim() ?? '',
          }))
          resolve(rows)
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
