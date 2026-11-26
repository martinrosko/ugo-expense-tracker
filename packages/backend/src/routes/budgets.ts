import { Router } from 'express'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { propagateBudgetCreated, removeTemplateBudget } from '../services/templateSync.js'
import { sortByName } from '../services/sortNames.js'
import { canUseAccounts, loadViewer, planAccessWhere, viewForPlan } from '../services/access.js'

export const budgetsRouter = Router()

const ACCOUNT_REF = { id: true, name: true, type: true } as const
const txSelect = {
  id: true, amount: true, type: true, createdById: true,
  fromAccount: { select: ACCOUNT_REF },
  toAccount: { select: ACCOUNT_REF },
  template: { select: { fromAccount: { select: ACCOUNT_REF }, toAccount: { select: ACCOUNT_REF } } },
} as const

// GET /api/budgets?planId=xxx
budgetsRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const { planId } = req.query
  const userId = req.user!.sub
  const raw = await db.budget.findMany({
    where: {
      plan: planAccessWhere(userId),
      ...(planId ? { planId: String(planId) } : {}),
    },
    include: {
      template: { select: { name: true, amount: true, defaultAccountId: true } },
      plan: { select: { ownerId: true } },
      transactions: { select: txSelect },
    },
  })
  const viewer = await loadViewer(db, userId)
  const budgets = sortByName(raw.map(({ template, plan, transactions, ...b }) => ({
    ...b,
    name: b.name ?? template?.name ?? null,
    amount: b.amount ?? template?.amount ?? null,
    defaultAccountId: b.defaultAccountId ?? template?.defaultAccountId ?? null,
    transactions: viewForPlan(transactions, viewer, plan.ownerId, b.id),
  })))
  res.json(budgets)
})

// GET /api/budgets/:id
budgetsRouter.get('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const userId = req.user!.sub
  const raw = await db.budget.findFirst({
    where: { id, plan: planAccessWhere(userId) },
    include: {
      template: { select: { name: true, amount: true, defaultAccountId: true } },
      plan: { select: { ownerId: true } },
      transactions: { select: { ...txSelect, name: true, plannedAmount: true, plannedOn: true, executedOn: true, dueDateConfig: true, templateId: true, planId: true, budgetId: true, fromAccountId: true, toAccountId: true, stateCode: true, statusCode: true, bankTicketId: true } },
    },
  })
  if (!raw) { res.status(404).json({ error: 'Not found' }); return }
  const { template, plan, transactions, ...budget } = raw
  res.json({
    ...budget,
    name: budget.name ?? template?.name ?? null,
    amount: budget.amount ?? template?.amount ?? null,
    defaultAccountId: budget.defaultAccountId ?? template?.defaultAccountId ?? null,
    transactions: viewForPlan(transactions, await loadViewer(db, userId), plan.ownerId, budget.id),
  })
})

// POST /api/budgets
budgetsRouter.post('/', async (req: AuthenticatedRequest, res) => {
  const { id, name, amount, planId, defaultAccountId, templateId, stateCode, statusCode } = req.body
  // Verify the plan belongs to this user
  const plan = await db.plan.findFirst({ where: { id: planId, ownerId: req.user!.sub } })
  if (!plan) { res.status(403).json({ error: 'Forbidden' }); return }
  if (!(await canUseAccounts(db, req.user!.sub, [defaultAccountId]))) { res.status(403).json({ error: 'Forbidden' }); return }
  const budget = await db.$transaction(async (tx) => {
    const created = await tx.budget.create({
      data: { ...(id ? { id } : {}), name, amount, planId, defaultAccountId, templateId, stateCode, statusCode },
    })
    await propagateBudgetCreated(tx, created)
    return created
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
  const deleted = await db.$transaction(async (tx) => {
    const plan = await tx.plan.findUnique({ where: { id: existing.planId }, select: { isTemplate: true } })
    if (plan?.isTemplate) await removeTemplateBudget(tx, existing)
    const own = { budgetId: id }
    if (await tx.transaction.count({ where: { ...own, executedOn: { not: null } } }) > 0) return false
    await tx.tagObject.deleteMany({ where: { transaction: own } })
    await tx.transaction.deleteMany({ where: own })
    await tx.budget.delete({ where: { id } })
    return true
  })
  if (!deleted) { res.status(409).json({ error: 'Budget has executed transactions and cannot be deleted' }); return }
  res.status(204).end()
})
