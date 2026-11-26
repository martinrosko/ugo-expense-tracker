import type { Prisma } from '@prisma/client'

export const ASSET_TYPES = ['CASH', 'BANK', 'INVESTMENT']

export type PlanAccess = 'OWNER' | 'CONTRIBUTOR' | 'VIEWER'

type Client = Prisma.TransactionClient

// ─── Query filters ────────────────────────────────────────────────────────────

/** Plans the user owns or belongs to; membership of a template also covers its generated plans. */
export const planAccessWhere = (userId: string): Prisma.PlanWhereInput => ({
  OR: [
    { ownerId: userId },
    { members: { some: { userId } } },
    { template: { members: { some: { userId } } } },
  ],
})

/** Accounts the user owns or co-owns. */
export const accountAccessWhere = (userId: string): Prisma.AccountWhereInput => ({
  OR: [{ ownerId: userId }, { coOwners: { some: { userId } } }],
})

const contributorOf = (userId: string): Prisma.PlanWhereInput => ({
  OR: [
    { members: { some: { userId, role: 'CONTRIBUTOR' } } },
    { template: { members: { some: { userId, role: 'CONTRIBUTOR' } } } },
  ],
})

/** Transactions that may be looked at: in an accessible plan, or on an account the user owns or co-owns. */
export const txReadWhere = (userId: string): Prisma.TransactionWhereInput => ({
  OR: [
    { plan: planAccessWhere(userId) },
    { budget: { plan: planAccessWhere(userId) } },
    { fromAccount: accountAccessWhere(userId) },
    { toAccount: accountAccessWhere(userId) },
    { fromAccountId: null, template: { fromAccount: accountAccessWhere(userId) } },
    { toAccountId: null, template: { toAccount: accountAccessWhere(userId) } },
  ],
})

/** Transactions that may be changed: any in an owned plan, or the user's own ones in a plan they contribute to. */
export const txMutateWhere = (userId: string): Prisma.TransactionWhereInput => ({
  OR: [
    { plan: { ownerId: userId } },
    { budget: { plan: { ownerId: userId } } },
    { createdById: userId, plan: contributorOf(userId) },
    { createdById: userId, budget: { plan: contributorOf(userId) } },
  ],
})

// ─── Roles ────────────────────────────────────────────────────────────────────

export async function planAccess(client: Client, planId: string, userId: string): Promise<PlanAccess | null> {
  const memberRoles = { where: { userId }, select: { role: true } }
  const plan = await client.plan.findUnique({
    where: { id: planId },
    select: { ownerId: true, members: memberRoles, template: { select: { members: memberRoles } } },
  })
  if (!plan) return null
  if (plan.ownerId === userId) return 'OWNER'
  const roles = [...plan.members, ...(plan.template?.members ?? [])].map((m) => m.role)
  if (roles.includes('CONTRIBUTOR')) return 'CONTRIBUTOR'
  return roles.length > 0 ? 'VIEWER' : null
}

// ─── Transaction visibility ───────────────────────────────────────────────────

type AccountRef = { id: string; name: string; type: string }

/** A transaction with its template values already merged in, so `fromAccount` and `toAccount` are the effective ones. */
export type VisibleTx = {
  id: string
  createdById?: string | null
  fromAccount?: AccountRef | null
  toAccount?: AccountRef | null
}

export type TxViewer = { userId: string; accountIds: Set<string> }

export async function loadViewer(client: Client, userId: string): Promise<TxViewer> {
  const rows = await client.account.findMany({ where: accountAccessWhere(userId), select: { id: true } })
  return { userId, accountIds: new Set(rows.map((r) => r.id)) }
}

/** Details are for those who co-own an involved asset account; without one, for the creator (the plan owner for generated rows). */
export function canSeeDetails(tx: VisibleTx, viewer: TxViewer, planOwnerId: string): boolean {
  const assets = [tx.fromAccount, tx.toAccount].filter((a): a is AccountRef => !!a && ASSET_TYPES.includes(a.type))
  if (assets.length > 0) return assets.some((a) => viewer.accountIds.has(a.id))
  return (tx.createdById ?? planOwnerId) === viewer.userId
}

const redactAccount = <A extends AccountRef | null | undefined>(ref: A, viewer: TxViewer): A =>
  ref && ASSET_TYPES.includes(ref.type) && !viewer.accountIds.has(ref.id)
    ? ({ id: '', name: 'Private account', type: ref.type } as A)
    : ref

/** The counterpart account of a transaction the viewer can see is shown without identity. */
export function redactTransaction<T extends VisibleTx>(tx: T, viewer: TxViewer): T {
  const fromAccount = redactAccount(tx.fromAccount, viewer)
  const toAccount = redactAccount(tx.toAccount, viewer)
  const ids = tx as { fromAccountId?: unknown; toAccountId?: unknown }
  return {
    ...tx,
    fromAccount,
    toAccount,
    ...('fromAccountId' in ids && fromAccount !== tx.fromAccount ? { fromAccountId: null } : {}),
    ...('toAccountId' in ids && toAccount !== tx.toAccount ? { toAccountId: null } : {}),
  }
}

type MaskSource = VisibleTx & {
  amount: unknown; plannedAmount?: unknown; plannedOn?: unknown; executedOn?: unknown
  dueDateConfig?: unknown; type?: unknown; templateId?: string | null
}

/** Only what the plan totals need: dates, amounts, direction and whether it came from a template. */
export function maskTransaction(tx: MaskSource, key: string) {
  const side = (ref: AccountRef | null | undefined) =>
    ref ? { id: '', name: '', type: ASSET_TYPES.includes(ref.type) ? 'BANK' : 'PAYMENT_PARTNER' } : null
  return {
    id: key,
    masked: true as const,
    name: 'Private transaction',
    amount: tx.amount,
    plannedAmount: tx.plannedAmount ?? null,
    plannedOn: tx.plannedOn ?? null,
    executedOn: tx.executedOn ?? null,
    dueDateConfig: tx.dueDateConfig ?? null,
    type: tx.type,
    templateId: tx.templateId ? 'masked' : null,
    bankTicketId: null,
    fromAccount: side(tx.fromAccount),
    toAccount: side(tx.toAccount),
  }
}

type TemplateValues = {
  fromAccountId?: string | null; toAccountId?: string | null
  fromAccount?: AccountRef | null; toAccount?: AccountRef | null
  plannedAmount?: unknown; plannedOn?: unknown; dueDateConfig?: unknown
}

/** Plan views keep hidden rows as masked ones, so totals stay complete. Rows may still carry their template. */
export function viewForPlan<T extends MaskSource & { template?: TemplateValues | null }>(
  txs: T[], viewer: TxViewer, planOwnerId: string, keyPrefix: string, edit?: { role: PlanAccess; isTemplate: boolean },
) {
  // Tells the UI which rows to offer actions on; the routes enforce the same rule
  const canEdit = (tx: T) => !edit ? {} : {
    canEdit: edit.role === 'OWNER' || (edit.role === 'CONTRIBUTOR' && !edit.isTemplate && tx.createdById === viewer.userId),
  }
  return txs.map((tx, i) => {
    const tpl = tx.template
    const effective = { ...tx, fromAccount: tx.fromAccount ?? tpl?.fromAccount ?? null, toAccount: tx.toAccount ?? tpl?.toAccount ?? null }
    if (!canSeeDetails(effective, viewer, planOwnerId)) {
      return {
        ...maskTransaction({
          ...effective,
          plannedAmount: tx.plannedAmount ?? tpl?.plannedAmount,
          plannedOn: tx.plannedOn ?? tpl?.plannedOn,
          dueDateConfig: tx.dueDateConfig ?? tpl?.dueDateConfig,
        }, `masked:${keyPrefix}:${i}`),
        canEdit: false,
      }
    }
    const visible = { ...redactTransaction(tx, viewer), ...canEdit(tx) }
    if (!tpl) return visible
    const fromAccount = redactAccount(tpl.fromAccount, viewer)
    const toAccount = redactAccount(tpl.toAccount, viewer)
    return {
      ...visible,
      template: {
        ...tpl,
        fromAccount,
        toAccount,
        ...('fromAccountId' in tpl && fromAccount !== tpl.fromAccount ? { fromAccountId: null } : {}),
        ...('toAccountId' in tpl && toAccount !== tpl.toAccount ? { toAccountId: null } : {}),
      },
    }
  })
}

/** Account-based lists drop hidden rows. */
export function viewForList<T extends VisibleTx>(txs: T[], viewer: TxViewer, ownerOf: (tx: T) => string) {
  return txs.filter((tx) => canSeeDetails(tx, viewer, ownerOf(tx))).map((tx) => redactTransaction(tx, viewer))
}

// ─── Account use ──────────────────────────────────────────────────────────────

/** True when every given account id belongs to or is co-owned by the user. */
export async function canUseAccounts(client: Client, userId: string, ids: unknown[]): Promise<boolean> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))]
  if (wanted.length === 0) return true
  const found = await client.account.count({ where: { id: { in: wanted }, ...accountAccessWhere(userId) } })
  return found === wanted.length
}
