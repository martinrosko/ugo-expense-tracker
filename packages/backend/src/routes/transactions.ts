import { Router } from 'express'
import type { Prisma } from '@prisma/client'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { isTemplateTransaction, propagateTransactionCreated, removeTemplateTransaction } from '../services/templateSync.js'
import { replaceObjectTags } from '../services/tagObjects.js'
import {
  accountAccessWhere, canSeeDetails, canUseAccounts, loadViewer, planAccess, planAccessWhere, redactTransaction,
  txMutateWhere, txReadWhere, viewForList, type PlanAccess,
} from '../services/access.js'

export const transactionsRouter = Router()

const ACCOUNT_REF = { id: true, name: true, type: true } as const
const planRefs = { select: { ownerId: true } } as const

// Makes the transaction's tags equal to tagIds; a missing tagIds leaves them untouched
const replaceTags = (client: Prisma.TransactionClient, transactionId: string, ownerId: string, tagIds: unknown) =>
  replaceObjectTags(client, 'transaction', transactionId, ownerId, tagIds)

/** The role the user may add transactions to the plan with; contributors may not touch template plans. */
async function addRole(planId: string | null | undefined, userId: string): Promise<PlanAccess | null> {
  if (!planId) return null
  const role = await planAccess(db, planId, userId)
  if (role === 'OWNER') return role
  if (role !== 'CONTRIBUTOR') return null
  const plan = await db.plan.findUnique({ where: { id: planId }, select: { isTemplate: true } })
  return plan?.isTemplate === false ? role : null
}

/** True when a side was redacted because the viewer does not co-own that account. */
const hasPrivateSide = (tx: { fromAccount?: { id: string } | null; toAccount?: { id: string } | null }) =>
  tx.fromAccount?.id === '' || tx.toAccount?.id === ''

async function canUseBankTicket(ticketId: unknown, userId: string): Promise<boolean> {
  if (typeof ticketId !== 'string' || ticketId === '') return true
  return (await db.bankTicket.count({ where: { id: ticketId, account: accountAccessWhere(userId) } })) > 0
}

/** Finds a transaction the user may read in detail (`mutate` also requires the right to change it). */
async function loadTransaction(id: string, userId: string, mutate: boolean) {
  const row = await db.transaction.findFirst({
    where: { id, ...(mutate ? txMutateWhere(userId) : txReadWhere(userId)) },
    include: {
      template: { select: { fromAccount: { select: ACCOUNT_REF }, toAccount: { select: ACCOUNT_REF } } },
      fromAccount: { select: ACCOUNT_REF },
      toAccount: { select: ACCOUNT_REF },
      plan: planRefs,
      budget: { select: { plan: planRefs } },
    },
  })
  if (!row) return null
  const planOwnerId = row.plan?.ownerId ?? row.budget?.plan.ownerId ?? userId
  const effective = { ...row, fromAccount: row.fromAccount ?? row.template?.fromAccount ?? null, toAccount: row.toAccount ?? row.template?.toAccount ?? null }
  if (!canSeeDetails(effective, await loadViewer(db, userId), planOwnerId)) return null
  return { row, planOwnerId }
}

// GET /api/transactions?budgetId=xxx&planId=xxx&unmatched=true&from=YYYY-MM-DD&to=YYYY-MM-DD&executed=true
transactionsRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.sub
  const { budgetId, planId, unmatched, from, to, executed, accountId, isTemplate } = req.query
  const fromDate = from ? new Date(String(from).slice(0, 10)) : null
  const toDate = to ? new Date(String(to).slice(0, 10) + 'T23:59:59') : null
  const raw = await db.transaction.findMany({
    where: {
      ...txReadWhere(userId),
      // Separate AND entries so the OR clauses don't overwrite each other or the access filter
      AND: [
        // A template plan or budget also matches everything of its instances
        ...(budgetId ? [{ OR: [{ budgetId: String(budgetId) }, { budget: { templateId: String(budgetId) } }] }] : []),
        ...(planId ? [{ OR: [
          { planId: String(planId) }, { budget: { planId: String(planId) } },
          { plan: { templateId: String(planId) } }, { budget: { plan: { templateId: String(planId) } } },
        ] }] : []),
        // Accounts not overridden on the transaction come from its template
        ...(accountId ? [{ OR: [
          { fromAccountId: String(accountId) }, { toAccountId: String(accountId) },
          { fromAccountId: null, template: { fromAccountId: String(accountId) } },
          { toAccountId: null, template: { toAccountId: String(accountId) } },
        ] }] : []),
        // The second ticket of a movement counts as a ticket of its account
        ...(unmatched === 'true' && accountId ? [{ pairedTickets: { none: { accountId: String(accountId) } } }] : []),
      ],
      ...(unmatched === 'true' ? { bankTicketId: null } : {}),
      ...(executed === 'true' ? { executedOn: { not: null } } : {}),
      ...(fromDate && toDate ? { executedOn: { gte: fromDate, lte: toDate } } : {}),
      ...(isTemplate === 'true' ? { isTemplate: { eq: true } } : {}),

    },
    include: {
      template: { select: { name: true, plannedAmount: true, plannedOn: true, dueDateConfig: true, fromAccountId: true, toAccountId: true, fromAccount: { select: ACCOUNT_REF }, toAccount: { select: ACCOUNT_REF } } },
      tags: { where: { tag: { ownerId: userId } }, include: { tag: true } },
      bankTicket: true,
      fromAccount: { select: ACCOUNT_REF },
      toAccount: { select: ACCOUNT_REF },
      plan: { select: { id: true, ownerId: true, name: true, startDate: true, endDate: true, statusCode: true, template: { select: { name: true } } } },
      budget: { select: { id: true, name: true, statusCode: true, template: { select: { name: true } }, plan: { select: { id: true, ownerId: true, name: true, startDate: true, endDate: true, statusCode: true, template: { select: { name: true } } } } } },
    },
    orderBy: { executedOn: 'desc' },
  })
  const merged = raw.map(({ template, ...tx }) => ({
    ...tx,
    name: tx.name ?? template?.name ?? null,
    plannedAmount: tx.plannedAmount ?? template?.plannedAmount ?? null,
    plannedOn: tx.plannedOn ?? template?.plannedOn ?? null,
    dueDateConfig: tx.dueDateConfig ?? template?.dueDateConfig ?? null,
    fromAccountId: tx.fromAccountId ?? template?.fromAccountId ?? null,
    toAccountId: tx.toAccountId ?? template?.toAccountId ?? null,
    // Accounts not overridden on the transaction come from its template
    fromAccount: tx.fromAccount ?? template?.fromAccount ?? null,
    toAccount: tx.toAccount ?? template?.toAccount ?? null,
  }))
  const viewer = await loadViewer(db, userId)
  const visible = viewForList(merged, viewer, (t) => (t.plan ?? t.budget?.plan)?.ownerId ?? userId)

  // Account co-owners need not belong to the plan a transaction sits in
  const planIds = [...new Set(visible.flatMap((t) => [t.plan?.id, t.budget?.plan.id]).filter((id): id is string => !!id))]
  const open = new Set((await db.plan.findMany({ where: { id: { in: planIds }, ...planAccessWhere(userId) }, select: { id: true } })).map((p) => p.id))
  const editable = new Set((await db.transaction.findMany({ where: { id: { in: visible.map((t) => t.id) }, ...txMutateWhere(userId) }, select: { id: true } })).map((t) => t.id))
  res.json(visible.map((t) => ({
    ...t,
    canEdit: editable.has(t.id),
    tags: hasPrivateSide(t) ? [] : t.tags,
    plan: t.plan && open.has(t.plan.id) ? t.plan : null,
    budget: t.budget && open.has(t.budget.plan.id) ? t.budget : null,
    bankTicket: t.bankTicket && viewer.accountIds.has(t.bankTicket.accountId) ? t.bankTicket : null,
  })))
})

// GET /api/transactions/:id
transactionsRouter.get('/:id', async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.sub
  const id = String(req.params.id)
  const raw = await db.transaction.findFirst({
    where: { id, ...txReadWhere(userId) },
    include: {
      template: { select: { name: true, plannedAmount: true, plannedOn: true, dueDateConfig: true, fromAccountId: true, toAccountId: true, fromAccount: { select: ACCOUNT_REF }, toAccount: { select: ACCOUNT_REF } } },
      tags: { where: { tag: { ownerId: userId } }, include: { tag: true } },
      bankTicket: true,
      fromAccount: { select: ACCOUNT_REF },
      toAccount: { select: ACCOUNT_REF },
      plan: planRefs,
      budget: { select: { plan: planRefs } },
    },
  })
  if (!raw) { res.status(404).json({ error: 'Not found' }); return }
  const { template, ...tx } = raw
  const viewer = await loadViewer(db, userId)
  const merged = {
    ...tx,
    name: tx.name ?? template?.name ?? null,
    plannedAmount: tx.plannedAmount ?? template?.plannedAmount ?? null,
    plannedOn: tx.plannedOn ?? template?.plannedOn ?? null,
    dueDateConfig: tx.dueDateConfig ?? template?.dueDateConfig ?? null,
    fromAccountId: tx.fromAccountId ?? template?.fromAccountId ?? null,
    toAccountId: tx.toAccountId ?? template?.toAccountId ?? null,
    fromAccount: tx.fromAccount ?? template?.fromAccount ?? null,
    toAccount: tx.toAccount ?? template?.toAccount ?? null,
  }
  if (!canSeeDetails(merged, viewer, tx.plan?.ownerId ?? tx.budget?.plan.ownerId ?? userId)) { res.status(404).json({ error: 'Not found' }); return }
  const shown = redactTransaction(merged, viewer)
  res.json({ ...shown, tags: hasPrivateSide(shown) ? [] : shown.tags, bankTicket: merged.bankTicket && viewer.accountIds.has(merged.bankTicket.accountId) ? merged.bankTicket : null })
})

// POST /api/transactions
transactionsRouter.post('/', async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.sub
  const { id, name, amount, plannedAmount, plannedOn, executedOn, dueDateConfig, type, budgetId, planId, bankTicketId, fromAccountId, toAccountId, templateId, stateCode, statusCode, tagIds } = req.body
  let role: PlanAccess | null = 'OWNER'
  // The target plan must be the user's own or one they contribute to
  if (budgetId || planId) {
    const targetPlanId = budgetId ? (await db.budget.findUnique({ where: { id: String(budgetId) }, select: { planId: true } }))?.planId : String(planId)
    role = await addRole(targetPlanId, userId)
    if (!role) { res.status(403).json({ error: 'Forbidden' }); return }
  }
  if (!(await canUseAccounts(db, userId, [fromAccountId, toAccountId])) || !(await canUseBankTicket(bankTicketId, userId))) {
    res.status(403).json({ error: 'Forbidden' }); return
  }
  const owner = role === 'OWNER'

  const tx = await db.$transaction(async (client) => {
    const created = await client.transaction.create({
      data: {
        ...(id ? { id } : {}),
        name,
        amount,
        plannedAmount,
        plannedOn: plannedOn ? new Date(plannedOn) : undefined,
        executedOn: executedOn ? new Date(executedOn) : undefined,
        dueDateConfig,
        type,
        budgetId,
        planId,
        bankTicketId,
        fromAccountId,
        toAccountId,
        // Contributors cannot tie a row to a template or set its lifecycle
        templateId: owner ? templateId : undefined,
        stateCode: owner ? stateCode : undefined,
        statusCode: owner ? statusCode : undefined,
        createdById: userId,
      },
      include: { tags: { where: { tag: { ownerId: userId } }, include: { tag: true } } },
    })
    await replaceTags(client, created.id, userId, tagIds)
    await propagateTransactionCreated(client, created)
    return created
  })
  res.status(201).json(tx)
})

// PATCH /api/transactions/:id
transactionsRouter.patch('/:id', async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.sub
  const id = String(req.params.id)
  const found = await loadTransaction(id, userId, true)
  if (!found) { res.status(404).json({ error: 'Not found' }); return }
  const existing = found.row
  const owner = found.planOwnerId === userId
  const { name, amount, plannedAmount, plannedOn, executedOn, dueDateConfig, type, bankTicketId, fromAccountId, toAccountId, templateId, stateCode, statusCode, tagIds } = req.body
  if (!(await canUseAccounts(db, userId, [fromAccountId, toAccountId])) || !(await canUseBankTicket(bankTicketId, userId))) {
    res.status(403).json({ error: 'Forbidden' }); return
  }
  // Moving: a transaction belongs either to a budget or directly to a plan; planned (template-based) ones stay where they are
  const moving = req.body.budgetId !== undefined || req.body.planId !== undefined
  if (moving) {
    if (existing.templateId) { res.status(409).json({ error: 'Planned transactions cannot be moved' }); return }
    const { budgetId, planId } = req.body
    const targetPlanId = budgetId ? (await db.budget.findUnique({ where: { id: String(budgetId) }, select: { planId: true } }))?.planId : String(planId)
    const target = targetPlanId ? await db.plan.findFirst({ where: { id: targetPlanId, isTemplate: false }, select: { id: true } }) : null
    if (!target || !(await addRole(target.id, userId))) { res.status(403).json({ error: 'Forbidden' }); return }
  }
  const tx = await db.$transaction(async (client) => {
    await replaceTags(client, id, userId, tagIds)
    return client.transaction.update({
      where: { id },
      data: {
        ...(moving ? { budgetId: req.body.budgetId ? String(req.body.budgetId) : null, planId: req.body.budgetId ? null : String(req.body.planId) } : {}),
        name,
        amount,
        plannedAmount,
        plannedOn: plannedOn ? new Date(plannedOn) : undefined,
        executedOn: executedOn ? new Date(executedOn) : undefined,
        dueDateConfig,
        type,
        bankTicketId,
        fromAccountId,
        toAccountId,
        templateId: owner ? templateId : undefined,
        stateCode: owner ? stateCode : undefined,
        statusCode: owner ? statusCode : undefined,
      },
      include: { tags: { where: { tag: { ownerId: userId } }, include: { tag: true } } },
    })
  })
  res.json(tx)
})

// DELETE /api/transactions/:id
transactionsRouter.delete('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const found = await loadTransaction(id, req.user!.sub, true)
  if (!found) { res.status(404).json({ error: 'Not found' }); return }
  const existing = found.row
  await db.$transaction(async (tx) => {
    if (await isTemplateTransaction(tx, existing)) await removeTemplateTransaction(tx, existing)
    await tx.tagObject.deleteMany({ where: { transactionId: id } })
    await tx.transaction.delete({ where: { id } })
  })
  res.status(204).end()
})

// POST /api/transactions/:id/execute  body: { executedOn?: ISO date, amount?: number, name?, fromAccountId?, toAccountId? }
// Logs a planned transaction of an active plan as executed; amount defaults to the planned amount.
transactionsRouter.post('/:id/execute', async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.sub
  const id = String(req.params.id)
  if (!(await loadTransaction(id, userId, true))) { res.status(404).json({ error: 'Not found' }); return }
  const existing = await db.transaction.findUnique({
    where: { id },
    include: { template: true, plan: true, budget: { include: { plan: true } } },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  const plan = existing.plan ?? existing.budget?.plan
  if (!plan || plan.isTemplate || (plan.statusCode !== 1 && plan.statusCode !== 3)) { res.status(409).json({ error: 'Only transactions of active or completed plans can be executed' }); return }
  if (existing.executedOn) { res.status(409).json({ error: 'Transaction is already executed' }); return }

  const executedOn = req.body?.executedOn ? new Date(req.body.executedOn) : new Date()
  if (isNaN(executedOn.getTime())) { res.status(400).json({ error: 'Invalid executedOn' }); return }
  const amount = Number(req.body?.amount ?? existing.plannedAmount ?? existing.template?.plannedAmount)
  if (!Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: 'A positive amount is required' }); return }
  if (!(await canUseAccounts(db, userId, [req.body?.fromAccountId, req.body?.toAccountId]))) { res.status(403).json({ error: 'Forbidden' }); return }

  const tx = await db.$transaction(async (client) => {
    await replaceTags(client, id, userId, req.body?.tagIds)
    return client.transaction.update({
      where: { id },
      data: {
        executedOn,
        amount: amount.toFixed(4),
        // Values changed while executing become overrides of the template values
        name: typeof req.body?.name === 'string' ? req.body.name : undefined,
        fromAccountId: typeof req.body?.fromAccountId === 'string' ? req.body.fromAccountId : undefined,
        toAccountId: typeof req.body?.toAccountId === 'string' ? req.body.toAccountId : undefined,
      },
    })
  })
  res.json(tx)
})

// POST /api/transactions/:id/unlink-bank-ticket
// Detaches the bank ticket but keeps it, unprocessed, so it can be linked to another transaction.
transactionsRouter.post('/:id/unlink-bank-ticket', async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.sub
  const id = String(req.params.id)
  const found = await loadTransaction(id, userId, true)
  if (!found) { res.status(404).json({ error: 'Not found' }); return }
  const bankTicketId = found.row.bankTicketId
  if (!bankTicketId) { res.status(409).json({ error: 'Transaction has no bank ticket' }); return }
  if (!(await canUseBankTicket(bankTicketId, userId))) { res.status(403).json({ error: 'Forbidden' }); return }
  await db.$transaction(async (client) => {
    await client.transaction.update({ where: { id }, data: { bankTicketId: null } })
    await client.bankTicket.update({ where: { id: bankTicketId }, data: { stateCode: 0, pairedTransactionId: null } })
  })
  res.status(204).end()
})

// POST /api/transactions/:id/unexecute
// Reverts an executed template-based transaction to its planned state.
transactionsRouter.post('/:id/unexecute', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const found = await loadTransaction(id, req.user!.sub, true)
  if (!found) { res.status(404).json({ error: 'Not found' }); return }
  const existing = found.row
  if (!existing.executedOn) { res.status(409).json({ error: 'Transaction is not executed' }); return }
  if (!existing.templateId) { res.status(409).json({ error: 'Only template transactions can be discarded; delete it instead' }); return }
  const tx = await db.$transaction(async (client) => {
    await client.tagObject.deleteMany({ where: { transactionId: id } })
    return client.transaction.update({ where: { id }, data: { executedOn: null, amount: null, bankTicketId: null } })
  })
  res.json(tx)
})

// POST /api/transactions/:id/tags
transactionsRouter.post('/:id/tags', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  if (!(await loadTransaction(id, req.user!.sub, false))) { res.status(404).json({ error: 'Not found' }); return }
  const { id: linkId, tagId, amount } = req.body
  const ownTag = await db.tag.findFirst({ where: { id: String(tagId), ownerId: req.user!.sub }, select: { id: true } })
  if (!ownTag) { res.status(404).json({ error: 'Tag not found' }); return }
  const duplicate = await db.tagObject.findFirst({
    where: { OR: [{ transactionId: id, tagId: ownTag.id }, ...(linkId ? [{ id: String(linkId) }] : [])] },
    select: { id: true },
  })
  if (duplicate) { res.status(409).json({ error: 'Tag is already assigned' }); return }
  const tag = await db.tagObject.create({
    data: { ...(linkId ? { id: String(linkId) } : {}), transactionId: id, tagId: ownTag.id, amount },
    include: { tag: true },
  })
  res.status(201).json(tag)
})

// DELETE /api/transactions/:id/tags/:tagId
transactionsRouter.delete('/:id/tags/:tagId', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const tagId = String(req.params.tagId)
  if (!(await loadTransaction(id, req.user!.sub, false))) { res.status(404).json({ error: 'Not found' }); return }
  // Only the user's own tag links; other users' tags on the same row stay
  await db.tagObject.deleteMany({
    where: { transactionId: id, tagId, tag: { ownerId: req.user!.sub } },
  })
  res.status(204).end()
})
