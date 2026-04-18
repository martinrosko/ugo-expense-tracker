/** One parsed row from a bank CSV export, field names mirroring rw_bankticket. */
export interface CsvRow {
  /** Transaction execution date → rw_executedon */
  executedon: string
  /** Transaction amount (negative = expense) → rw_amount */
  amount: number
  /** Counter-party name → rw_partnername */
  partnername: string
  /** Counter-party IBAN/account number → rw_partneraccountnumber */
  partneraccountnumber: string
  /** Free-text reference → rw_reference */
  reference: string
  /** Variable symbol (Czech/SK banking) → rw_variablesymbol */
  variablesymbol: string
  /** Constant symbol → rw_constantsymbol */
  constantsymbol: string
  /** Specific symbol → rw_specificsymbol */
  specificsymbol: string
  /** Bank's own transaction ID — used for deduplication → rw_ticketid */
  ticketid: string
}
