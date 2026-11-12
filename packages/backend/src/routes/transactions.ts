import { Router } from 'express'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { isTemplateTransaction, propagateTransactionCreated, removeTemplateTransaction } from '../services/templateSync.js'

export const transactionsRouter = Router()

// Ownership filter: transaction belongs to user if its budget→plan or plan is owned by user
const ownerFilter = (ownerId: string) => ({
  OR: [
    { budget: { plan: { ownerId } } },
    { plan: { ownerId } },
  ],
})

// GET /api/transactions?budgetId=xxx&planId=xxx&unmatched=true&from=YYYY-MM-DD&to=YYYY-MM-DD&executed=true
transactionsRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const { budgetId, planId, unmatched, from, to, executed, accountId, isTemplate } = req.query
  const fromDate = from ? new Date(String(from).slice(0, 10)) : null
  const toDate = to ? new Date(String(to).slice(0, 10) + 'T23:59:59') : null
  const raw = await db.transaction.findMany({
    where: {
      ...ownerFilter(req.user!.sub),
      ...(budgetId ? { budgetId: String(budgetId) } : {}),
      // Separate AND entries so the OR clauses don't overwrite each other or the owner filter
      AND: [
        ...(planId ? [{ OR: [{ planId: String(planId) }, { budget: { planId: String(planId) } }] }] : []),
        ...(accountId ? [{ OR: [{ fromAccountId: String(accountId) }, { toAccountId: String(accountId) }] }] : []),
      ],
      ...(unmatched === 'true' ? { bankTicketId: null } : {}),
      ...(executed === 'true' ? { executedOn: { not: null } } : {}),
      ...(fromDate && toDate ? { executedOn: { gte: fromDate, lte: toDate } } : {}),
      ...(isTemplate === 'true' ? { isTemplate: { eq: true } } : {}),

    },
    include: {
      template: { select: { name: true, plannedAmount: true, plannedOn: true, dueDateConfig: true, fromAccountId: true, toAccountId: true } },
      tags: { include: { tag: true } },
      bankTicket: true,
      fromAccount: { select: { id: true, name: true, type: true } },
      toAccount: { select: { id: true, name: true, type: true } },
      plan: { select: { id: true, name: true, startDate: true, endDate: true } },
      budget: { select: { id: true, name: true, plan: { select: { id: true, name: true, startDate: true, endDate: true } } } },
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
        tags: tagIds?.length
          ? { create: tagIds.map((tagId: string) => ({ tagId })) }
          : undefined,
      },
      include: { tags: { include: { tag: true } } },
    })
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
  const { name, amount, plannedAmount, plannedOn, executedOn, dueDateConfig, type, bankTicketId, fromAccountId, toAccountId, templateId, stateCode, statusCode } = req.body
  const tx = await db.transaction.update({
    where: { id },
    data: {
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
    await tx.transactionTag.deleteMany({ where: { transactionId: id } })
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
  if (!plan || plan.isTemplate || plan.statusCode !== 1) { res.status(409).json({ error: 'Only transactions of active plans can be executed' }); return }
  if (existing.executedOn) { res.status(409).json({ error: 'Transaction is already executed' }); return }

  const executedOn = req.body?.executedOn ? new Date(req.body.executedOn) : new Date()
  if (isNaN(executedOn.getTime())) { res.status(400).json({ error: 'Invalid executedOn' }); return }
  const amount = Number(req.body?.amount ?? existing.plannedAmount ?? existing.template?.plannedAmount)
  if (!Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: 'A positive amount is required' }); return }

  const tx = await db.transaction.update({
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
  res.json(tx)
})

// POST /api/transactions/:id/unexecute
// Reverts an executed template-based transaction to its planned state.
transactionsRouter.post('/:id/unexecute', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const existing = await db.transaction.findFirst({
    where: { id, ...ownerFilter(req.user!.sub) },
    include: { plan: true, budget: { include: { plan: true } } },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  const plan = existing.plan ?? existing.budget?.plan
  if (plan?.statusCode === 3 || existing.budget?.statusCode === 3) { res.status(409).json({ error: 'Transactions of completed plans can only be deleted' }); return }
  if (!existing.executedOn) { res.status(409).json({ error: 'Transaction is not executed' }); return }
  if (!existing.templateId) { res.status(409).json({ error: 'Only template transactions can be discarded; delete it instead' }); return }
  const tx = await db.$transaction(async (client) => {
    await client.transactionTag.deleteMany({ where: { transactionId: id } })
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
  const { tagId, amount } = req.body
  const tag = await db.transactionTag.create({
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
    where: { id, ...ownerFilter(req.user!.sub) },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  await db.transactionTag.deleteMany({
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
  const tag = await db.transactionTag.create({
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
  await db.transactionTag.deleteMany({
    where: { transactionId: id, tagId },
  })
  res.status(204).end()
})
