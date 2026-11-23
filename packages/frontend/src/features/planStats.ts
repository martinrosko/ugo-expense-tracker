import { computePlannedOn } from './helpers'


/** The part of a detailed plan the stats need */
export type PlanLike = {
  startDate: string | null
  endDate: string | null
  statusCode: number
  budgets: BudgetWithTx[]
  transactions: TxSummary[]
}
