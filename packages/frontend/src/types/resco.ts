// ─── Picklist constants ───────────────────────────────────────────────────────

export const AccountType = {
  Bank: 1,
  Cash: 2,
  Investment: 3,
  PaymentPartner: 100,
} as const
export type AccountType = (typeof AccountType)[keyof typeof AccountType]

export const TransactionType = {
  Transaction: 1,
  Balance: 2,
} as const
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType]

export const PlanIntervalType = {
  OneTime: 0,
  Weekly: 1,
  Monthly: 2,
  Yearly: 3,
} as const
export type PlanIntervalType = (typeof PlanIntervalType)[keyof typeof PlanIntervalType]

// ─── Entity interfaces (OData field names) ───────────────────────────────────
// Lookup GUIDs are surfaced as _fieldname_value by OData.
// To set a lookup on POST/PATCH use: "fieldname@odata.bind": "/entityset(guid)"

export interface RwAccount {
  id: string
  name: string
  rw_accounttype: AccountType
  rw_initialbalance?: number
  rw_isdefault?: boolean
  statecode?: number
}

/** Raw bank transaction extracted from a CSV export or bank service. */
export interface RwBankTicket {
  id?: string
  name?: string
  /** GUID of the user's bank/cash account (rw_account). */
  __rw_accountid_id?: string
  rw_amount?: number
  rw_constantsymbol?: string
  rw_executedon?: string           // ISO datetime
  rw_partneraccountnumber?: string
  rw_partnername?: string
  rw_reference?: string
  rw_specificsymbol?: string
  /** Bank's own transaction ID — used for duplicate detection. */
  rw_ticketid?: string
  rw_variablesymbol?: string
}

/** A planned or realized expense/income entry within a plan or budget. */
export interface RwTransaction {
  id: string
  name?: string
  rw_amount?: number
  /** Null means this transaction has not been matched to a real bank operation yet. */
  __rw_bankticketid_id?: string | null
  rw_duedateconfig?: string
  rw_executedon?: string
  __rw_fromaccountid_id?: string
  /** GUID of the parent rw_plan or rw_budget. */
  __rw_parentid_id?: string
  rw_plannedamount?: number
  rw_plannedon?: string
  rw_ticketid?: string
  __rw_templateid_id?: string
  __rw_toaccountid_id?: string
  rw_type?: TransactionType
  statecode?: number
  statuscode?: number
}

/** A spending category within a plan with an optional monetary cap. */
export interface RwBudget {
  id: string
  name: string
  rw_amount?: number
  __rw_defaultaccountid_id?: string
  /** GUID of the parent rw_plan. */
  __rw_parentid_id?: string
  __rw_templateid_id?: string
  statecode?: number
  statuscode?: number
}

/** A time-bounded financial plan (template or instance). */
export interface RwPlan {
  id: string
  name: string
  __rw_defaultaccountid_id?: string
  rw_enddate?: string
  rw_intervaltype?: PlanIntervalType
  rw_istemplate?: boolean
  rw_recurrenceconfig?: string
  rw_startdate?: string
  __rw_templateid_id?: string
  statecode?: number
  statuscode?: number
}

export interface RwTag {
  id: string
  name: string
  rw_color?: string
}

/** Junction record: assigns a tag to a transaction with optional partial amount. */
export interface RwTransactionTag {
  id?: string
  rw_amount?: number
  __rw_tagid_id?: string
  __rw_transactionid_id?: string
}

