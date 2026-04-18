import Papa from 'papaparse'
import type { CsvRow } from './types'

// ─── VÚB Banka Slovakia CSV export (Windows-1250 encoded) ───────────────────
const COLUMN_MAP: Record<keyof CsvRow, string> = {
  executedon:           'Dátum realizácie',
  amount:               'Suma',
  partnername:          'Doplňujúce informácie',  // primary merchant name
  partneraccountnumber: 'Účet partnera',
  reference:            'Referencia partnera',
  variablesymbol:       'VS',
  specificsymbol:       'ŠS',
  constantsymbol:       'KS',
  ticketid:             'Číslo dokladu',
}

// Fallback partner name when Doplňujúce informácie is empty (e.g. transfers)
const PARTNER_FALLBACK_COL = 'Názov partnera'

/** Convert VÚB date format YYYYMMDD → ISO yyyy-MM-dd */
function parseDate(raw: string): string {
  const s = raw.trim()
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return s
}

/**
 * Clean merchant name from "Doplňujúce informácie" column.
 * DD-prefixed card entries use ~ as word separator and end with a 2-char type
 * code (G1/P1/etc.). Direct card payments have extra internal spaces.
 */
function cleanMerchant(info: string, fallback: string): string {
  const s = info.trim()
  if (!s) return fallback.trim()
  if (s.startsWith('DD')) {
    const parts = s.slice(2).split('~').map((p) => p.trim()).filter(Boolean)
    // Drop trailing 2-char type code like G1, P1
    if (parts.length > 1 && /^[A-Z]\d$/.test(parts[parts.length - 1])) parts.pop()
    return parts.join(' ')
  }
  return s.replace(/\s{2,}/g, ' ')
}

export function parseCSV(file: File): Promise<CsvRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      encoding: 'windows-1250',
      complete(results) {
        try {
          const rows: CsvRow[] = results.data.map((row) => ({
            executedon: parseDate(row[COLUMN_MAP.executedon] ?? ''),
            amount: parseFloat(
              (row[COLUMN_MAP.amount] ?? '0').replace(/\s/g, '').replace(',', '.'),
            ),
            partnername: cleanMerchant(
              row[COLUMN_MAP.partnername] ?? '',
              row[PARTNER_FALLBACK_COL] ?? '',
            ),
            partneraccountnumber: row[COLUMN_MAP.partneraccountnumber]?.trim() ?? '',
            reference:            row[COLUMN_MAP.reference]?.trim() ?? '',
            variablesymbol:       row[COLUMN_MAP.variablesymbol]?.trim() ?? '',
            specificsymbol:       row[COLUMN_MAP.specificsymbol]?.trim() ?? '',
            constantsymbol:       row[COLUMN_MAP.constantsymbol]?.trim() ?? '',
            ticketid:             row[COLUMN_MAP.ticketid]?.trim() ?? '',
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
