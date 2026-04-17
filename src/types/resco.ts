// ─── Picklist constants ───────────────────────────────────────────────────────

export const AccountType = {
  Cash: 1,
  Bank: 2,
  Investment: 3,
  PaymentPartner: 100,
} as const
export type AccountType = (typeof AccountType)[keyof typeof AccountType]

export const TransactionType = {
  Expense: 1,
  Income: 2,
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
  rw_accountid: string
  name: string
  rw_accounttype: AccountType
  rw_initialbalance?: number
  rw_isdefault?: boolean
  statecode?: number
}

/** Raw bank transaction extracted from a CSV export or bank service. */
export interface RwBankTicket {
  rw_bankticketid?: string
  name?: string
  /** GUID of the user's bank/cash account (rw_account). */
  _rw_accountid_value?: string
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
  rw_transactionid: string
  name: string
  rw_amount?: number
  /** Null means this transaction has not been matched to a real bank operation yet. */
  _rw_bankticketid_value?: string | null
  rw_executedon?: string
  _rw_fromaccountid_value?: string
  /** GUID of the parent rw_plan or rw_budget. */
  _rw_parentid_value?: string
  /** Resolved by OData annotation; tells us whether parent is a plan or budget. */
  '_rw_parentid_value@Microsoft.Dynamics.CRM.lookuplogicalname'?: 'rw_plan' | 'rw_budget'
  rw_plannedamount?: number
  rw_plannedon?: string
  rw_ticketid?: string
  _rw_toaccountid_value?: string
  rw_type?: TransactionType
  statecode?: number
  statuscode?: number
}

/** A spending category within a plan with an optional monetary cap. */
export interface RwBudget {
  rw_budgetid: string
  name: string
  rw_amount?: number
  _rw_defaultaccountid_value?: string
  /** GUID of the parent rw_plan. */
  _rw_parentid_value?: string
  _rw_templateid_value?: string
  statecode?: number
  statuscode?: number
}

/** A time-bounded financial plan (template or instance). */
export interface RwPlan {
  rw_planid: string
  name: string
  _rw_defaultaccountid_value?: string
  rw_enddate?: string
  rw_intervaltype?: PlanIntervalType
  rw_istemplate?: boolean
  rw_recurrenceconfig?: string
  rw_startdate?: string
  _rw_templateid_value?: string
  statecode?: number
  statuscode?: number
}

export interface RwTag {
  rw_tagid: string
  name: string
  rw_color?: string
}

/** Junction record: assigns a tag to a transaction with optional partial amount. */
export interface RwTransactionTag {
  rw_transactiontagid?: string
  rw_amount?: number
  _rw_tagid_value?: string
  _rw_transactionid_value?: string
}

