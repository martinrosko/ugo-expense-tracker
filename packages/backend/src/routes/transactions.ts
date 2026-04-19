import { Router } from 'express'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

export const transactionsRouter = Router()

// Ownership filter: transaction belongs to user if its budget→plan or plan is owned by user
const ownerFilter = (ownerId: string) => ({
  OR: [
    { budget: { plan: { ownerId } } },
    { plan: { ownerId } },
  ],
})

// GET /api/transactions?budgetId=xxx&planId=xxx&unmatched=true
transactionsRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const { budgetId, planId, unmatched } = req.query
  const transactions = await db.transaction.findMany({
    where: {
      ...ownerFilter(req.user!.sub),
      ...(budgetId ? { budgetId: String(budgetId) } : {}),
      ...(planId ? { planId: String(planId) } : {}),
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
    where: { id, ...ownerFilter(req.user!.sub) },
    include: { tags: { include: { tag: true } }, bankTicket: true },
  })
  if (!tx) { res.status(404).json({ error: 'Not found' }); return }
  res.json(tx)
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

  const tx = await db.transaction.create({
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
  await db.transaction.delete({ where: { id } })
  res.status(204).end()
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
