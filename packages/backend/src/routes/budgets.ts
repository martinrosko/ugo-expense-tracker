import { Router } from 'express'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

export const budgetsRouter = Router()

// GET /api/budgets?planId=xxx
budgetsRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const { planId } = req.query
  const raw = await db.budget.findMany({
    where: {
      plan: { ownerId: req.user!.sub },
      ...(planId ? { planId: String(planId) } : {}),
    },
    include: {
      template: { select: { name: true, amount: true, defaultAccountId: true } },
      transactions: { select: { id: true, amount: true, type: true } },
    },
    orderBy: { name: 'asc' },
  })
  const budgets = raw.map(({ template, ...b }) => ({
    ...b,
    name: b.name ?? template?.name ?? null,
    amount: b.amount ?? template?.amount ?? null,
    defaultAccountId: b.defaultAccountId ?? template?.defaultAccountId ?? null,
  }))
  res.json(budgets)
})

// GET /api/budgets/:id
budgetsRouter.get('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const raw = await db.budget.findFirst({
    where: { id, plan: { ownerId: req.user!.sub } },
    include: {
      template: { select: { name: true, amount: true, defaultAccountId: true } },
      transactions: true,
    },
  })
  if (!raw) { res.status(404).json({ error: 'Not found' }); return }
  const { template, ...budget } = raw
  res.json({
    ...budget,
    name: budget.name ?? template?.name ?? null,
    amount: budget.amount ?? template?.amount ?? null,
    defaultAccountId: budget.defaultAccountId ?? template?.defaultAccountId ?? null,
  })
})

// POST /api/budgets
budgetsRouter.post('/', async (req: AuthenticatedRequest, res) => {
  const { id, name, amount, planId, defaultAccountId, templateId, stateCode, statusCode } = req.body
  // Verify the plan belongs to this user
  const plan = await db.plan.findFirst({ where: { id: planId, ownerId: req.user!.sub } })
  if (!plan) { res.status(403).json({ error: 'Forbidden' }); return }
  const budget = await db.budget.create({
    data: { ...(id ? { id } : {}), name, amount, planId, defaultAccountId, templateId, stateCode, statusCode },
  })
  res.status(201).json(budget)
})

// PATCH /api/budgets/:id
budgetsRouter.patch('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const existing = await db.budget.findFirst({
    where: { id, plan: { ownerId: req.user!.sub } },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  const { name, amount, defaultAccountId, templateId } = req.body
  const budget = await db.budget.update({
    where: { id },
    data: { name, amount, defaultAccountId, templateId },
  })
  res.json(budget)
})

// DELETE /api/budgets/:id
budgetsRouter.delete('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const existing = await db.budget.findFirst({
    where: { id, plan: { ownerId: req.user!.sub } },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  await db.budget.delete({ where: { id } })
  res.status(204).end()
})
