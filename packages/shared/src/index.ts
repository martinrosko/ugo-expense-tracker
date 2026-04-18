// ─── Enums ────────────────────────────────────────────────────────────────────

export enum AccountType {
  CASH = 'CASH',
  BANK = 'BANK',
  INVESTMENT = 'INVESTMENT',
  PAYMENT_PARTNER = 'PAYMENT_PARTNER',
}

export enum TransactionType {
  EXPENSE = 'EXPENSE',
  INCOME = 'INCOME',
}

export enum PlanIntervalType {
  ONE_TIME = 'ONE_TIME',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

// ─── Domain types (API response shape) ───────────────────────────────────────

export interface User {
  id: string
  email: string
  name: string
  businessUnitId?: string
}

export interface BusinessUnit {
  id: string
  name: string
}

export interface Account {
  id: string
  name: string
  type: AccountType
  initialBalance: number
  isDefault: boolean
  ownerId: string
}

export interface Plan {
  id: string
  name: string
  startDate: string   // ISO date
  endDate: string     // ISO date
  intervalType: PlanIntervalType
  isTemplate: boolean
  templateId?: string
  ownerId: string
}

export interface Budget {
  id: string
  name: string
  amount?: number
  planId: string
  defaultAccountId?: string
  templateId?: string
}

export interface BankTicket {
  id: string
  name?: string
  amount: number
  executedOn: string  // ISO date
  partnerName?: string
  partnerAccountNumber?: string
  reference?: string
  variableSymbol?: string
  constantSymbol?: string
  specificSymbol?: string
  ticketId?: string   // bank-assigned ID, used for deduplication
  accountId: string
}

export interface Transaction {
  id: string
  name: string
  amount?: number
  plannedAmount?: number
  plannedOn?: string   // ISO date
  executedOn?: string  // ISO date
  type: TransactionType
  bankTicketId?: string
  budgetId: string
  fromAccountId?: string
  toAccountId?: string
}

export interface Tag {
  id: string
  name: string
  color?: string
  ownerId: string
}

export interface TransactionTag {
  id: string
  transactionId: string
  tagId: string
  amount?: number
}

// ─── API pagination envelope ──────────────────────────────────────────────────

export interface PagedResult<T> {
  value: T[]
  total: number
  skip: number
  top: number
}
