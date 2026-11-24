import { Router } from 'express'
import type { Prisma } from '@prisma/client'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { isTemplateTransaction, propagateTransactionCreated, removeTemplateTransaction } from '../services/templateSync.js'
import { replaceObjectTags } from '../services/tagObjects.js'

export const transactionsRouter = Router()

// Ownership filter: transaction belongs to user if its budget→plan or plan is owned by user
const ownerFilter = (ownerId: string) => ({
  OR: [
    { budget: { plan: { ownerId } } },
    { plan: { ownerId } },
  ],
})

// Makes the transaction's tags equal to tagIds; a missing tagIds leaves them untouched
const replaceTags = (client: Prisma.TransactionClient, transactionId: string, ownerId: string, tagIds: unknown) =>
  replaceObjectTags(client, 'transaction', transactionId, ownerId, tagIds)

// GET /api/transactions?budgetId=xxx&planId=xxx&unmatched=true&from=YYYY-MM-DD&to=YYYY-MM-DD&executed=true
transactionsRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const { budgetId, planId, unmatched, from, to, executed, accountId, isTemplate } = req.query
  const fromDate = from ? new Date(String(from).slice(0, 10)) : null
  const toDate = to ? new Date(String(to).slice(0, 10) + 'T23:59:59') : null
  const raw = await db.transaction.findMany({
    where: {
      ...ownerFilter(req.user!.sub),
      // Separate AND entries so the OR clauses don't overwrite each other or the owner filter
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
      template: { select: { name: true, plannedAmount: true, plannedOn: true, dueDateConfig: true, fromAccountId: true, toAccountId: true, fromAccount: { select: { id: true, name: true, type: true } }, toAccount: { select: { id: true, name: true, type: true } } } },
      tags: { include: { tag: true } },
      bankTicket: true,
      fromAccount: { select: { id: true, name: true, type: true } },
      toAccount: { select: { id: true, name: true, type: true } },
      plan: { select: { id: true, name: true, startDate: true, endDate: true, statusCode: true, template: { select: { name: true } } } },
      budget: { select: { id: true, name: true, statusCode: true, template: { select: { name: true } }, plan: { select: { id: true, name: true, startDate: true, endDate: true, statusCode: true, template: { select: { name: true } } } } } },
    },
    orderBy: { executedOn: 'desc' },
  })
  const transactions = raw.map(({ template, ...tx }) => ({
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
  res.json(transactions)
})

// GET /api/transactions/:id
transactionsRouter.get('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const raw = await db.transaction.findFirst({
    where: { id, ...ownerFilter(req.user!.sub) },
    include: {
      template: { select: { name: true, plannedAmount: true, plannedOn: true, dueDateConfig: true, fromAccountId: true, toAccountId: true } },
      tags: { include: { tag: true } },
      bankTicket: true,
    },
  })
  if (!raw) { res.status(404).json({ error: 'Not found' }); return }
  const { template, ...tx } = raw
  res.json({
    ...tx,
    name: tx.name ?? template?.name ?? null,
    plannedAmount: tx.plannedAmount ?? template?.plannedAmount ?? null,
    plannedOn: tx.plannedOn ?? template?.plannedOn ?? null,
    dueDateConfig: tx.dueDateConfig ?? template?.dueDateConfig ?? null,
    fromAccountId: tx.fromAccountId ?? template?.fromAccountId ?? null,
    toAccountId: tx.toAccountId ?? template?.toAccountId ?? null,
  })
})

// POST /api/transactions
transactionsRouter.post('/', async (req: AuthenticatedRequest, res) => {
  const { id, name, amount, plannedAmount, plannedOn, executedOn, dueDateConfig, type, budgetId, planId, bankTicketId, fromAccountId, toAccountId, templateId, stateCode, statusCode, tagIds } = req.body
  // Verify ownership: at least one of budget or plan must belong to this user
  if (budgetId) {
    const budget = await db.budget.findFirst({ where: { id: budgetId, plan: { ownerId: req.user!.sub } } })
    if (!budget) { res.status(403).json({ error: 'Forbidden' }); return }
  } else if (planId) {
    const plan = await db.plan.findFirst({ where: { id: planId, ownerId: req.user!.sub } })
    if (!plan) { res.status(403).json({ error: 'Forbidden' }); return }
  }

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
        templateId,
        stateCode,
        statusCode,
      },
      include: { tags: { include: { tag: true } } },
    })
    await replaceTags(client, created.id, req.user!.sub, tagIds)
    await propagateTransactionCreated(client, created)
    return created
  })
  res.status(201).json(tx)
})

// PATCH /api/transactions/:id
transactionsRouter.patch('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const existing = await db.transaction.findFirst({
    where: { id, ...ownerFilter(req.user!.sub) },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  const { name, amount, plannedAmount, plannedOn, executedOn, dueDateConfig, type, bankTicketId, fromAccountId, toAccountId, templateId, stateCode, statusCode, tagIds } = req.body
  // Moving: a transaction belongs either to a budget or directly to a plan; planned (template-based) ones stay where they are
  const moving = req.body.budgetId !== undefined || req.body.planId !== undefined
  if (moving) {
    if (existing.templateId) { res.status(409).json({ error: 'Planned transactions cannot be moved' }); return }
    const { budgetId, planId } = req.body
    if (budgetId) {
      const budget = await db.budget.findFirst({ where: { id: String(budgetId), plan: { ownerId: req.user!.sub, isTemplate: false } } })
      if (!budget) { res.status(403).json({ error: 'Forbidden' }); return }
    } else {
      const plan = await db.plan.findFirst({ where: { id: String(planId), ownerId: req.user!.sub, isTemplate: false } })
      if (!plan) { res.status(403).json({ error: 'Forbidden' }); return }
    }
  }
  const tx = await db.$transaction(async (client) => {
    await replaceTags(client, id, req.user!.sub, tagIds)
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
        templateId,
        stateCode,
        statusCode,
      },
      include: { tags: { include: { tag: true } } },
    })
  })
  res.json(tx)
})

// DELETE /api/transactions/:id
transactionsRouter.delete('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const existing = await db.transaction.findFirst({
    where: { id, ...ownerFilter(req.user!.sub) },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
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
  const id = String(req.params.id)
  const existing = await db.transaction.findFirst({
    where: { id, ...ownerFilter(req.user!.sub) },
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

  const tx = await db.$transaction(async (client) => {
    await replaceTags(client, id, req.user!.sub, req.body?.tagIds)
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
  const id = String(req.params.id)
  const existing = await db.transaction.findFirst({
    where: { id, ...ownerFilter(req.user!.sub) },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  const bankTicketId = existing.bankTicketId
  if (!bankTicketId) { res.status(409).json({ error: 'Transaction has no bank ticket' }); return }
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
  const existing = await db.transaction.findFirst({
    where: { id, ...ownerFilter(req.user!.sub) },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
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
  const existing = await db.transaction.findFirst({
    where: { id, ...ownerFilter(req.user!.sub) },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
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
  const existing = await db.transaction.findFirst({
    where: { id, ...ownerFilter(req.user!.sub) },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  await db.tagObject.deleteMany({
    where: { transactionId: id, tagId },
  })
  res.status(204).end()
})

// GET /api/transactions?budgetId=xxx&unmatched=true
transactionsRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const { budgetId, unmatched } = req.query
  const transactions = await db.transaction.findMany({
    where: {
      budget: { plan: { ownerId: req.user!.sub } },
      ...(budgetId ? { budgetId: String(budgetId) } : {}),
      ...(unmatched === 'true' ? { bankTicketId: null } : {}),
    },
    include: {
      tags: { include: { tag: true } },
      bankTicket: true,
    },
    orderBy: { plannedOn: 'desc' },
  })
  res.json(transactions)
})

// GET /api/transactions/:id
transactionsRouter.get('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const tx = await db.transaction.findFirst({
    where: { id, budget: { plan: { ownerId: req.user!.sub } } },
    include: { tags: { include: { tag: true } }, bankTicket: true },
  })
  if (!tx) { res.status(404).json({ error: 'Not found' }); return }
  res.json(tx)
})

// POST /api/transactions
transactionsRouter.post('/', async (req: AuthenticatedRequest, res) => {
  const { name, amount, plannedAmount, plannedOn, executedOn, type, budgetId, bankTicketId, fromAccountId, toAccountId, tagIds } = req.body
  // Verify budget belongs to this user
  const budget = await db.budget.findFirst({
    where: { id: budgetId, plan: { ownerId: req.user!.sub } },
  })
  if (!budget) { res.status(403).json({ error: 'Forbidden' }); return }

  const tx = await db.transaction.create({
    data: {
      name,
      amount,
      plannedAmount,
      plannedOn: plannedOn ? new Date(plannedOn) : undefined,
      executedOn: executedOn ? new Date(executedOn) : undefined,
      type,
      budgetId,
      bankTicketId,
      fromAccountId,
      toAccountId,
      tags: tagIds?.length
        ? { create: tagIds.map((tagId: string) => ({ tagId })) }
        : undefined,
    },
    include: { tags: { include: { tag: true } } },
  })
  res.status(201).json(tx)
})

// PATCH /api/transactions/:id
transactionsRouter.patch('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const existing = await db.transaction.findFirst({
    where: { id, budget: { plan: { ownerId: req.user!.sub } } },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  const { name, amount, plannedAmount, plannedOn, executedOn, type, bankTicketId, fromAccountId, toAccountId } = req.body
  const tx = await db.transaction.update({
    where: { id },
    data: {
      name,
      amount,
      plannedAmount,
      plannedOn: plannedOn ? new Date(plannedOn) : undefined,
      executedOn: executedOn ? new Date(executedOn) : undefined,
      type,
      bankTicketId,
      fromAccountId,
      toAccountId,
    },
    include: { tags: { include: { tag: true } } },
  })
  res.json(tx)
})

// DELETE /api/transactions/:id
transactionsRouter.delete('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const existing = await db.transaction.findFirst({
    where: { id, budget: { plan: { ownerId: req.user!.sub } } },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  await db.transaction.delete({ where: { id } })
  res.status(204).end()
})

// POST /api/transactions/:id/tags
transactionsRouter.post('/:id/tags', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const existing = await db.transaction.findFirst({
    where: { id, budget: { plan: { ownerId: req.user!.sub } } },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  const { tagId, amount } = req.body
  const tag = await db.tagObject.create({
    data: { transactionId: id, tagId, amount },
    include: { tag: true },
  })
  res.status(201).json(tag)
})

// DELETE /api/transactions/:id/tags/:tagId
transactionsRouter.delete('/:id/tags/:tagId', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const tagId = String(req.params.tagId)
  const existing = await db.transaction.findFirst({
    where: { id, budget: { plan: { ownerId: req.user!.sub } } },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  await db.tagObject.deleteMany({
    where: { transactionId: id, tagId },
  })
  res.status(204).end()
})
