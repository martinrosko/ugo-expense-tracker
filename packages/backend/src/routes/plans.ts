import { Router } from 'express'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

export const plansRouter = Router()

// GET /api/plans?from=ISO&to=ISO&detailed=true
plansRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const { from, to, detailed, status } = req.query
  const ownerId = req.user!.sub

  // For @db.Date columns, use date-only strings to avoid timestamp/timezone mismatches
  const fromDate = from ? new Date(String(from).slice(0, 10)) : null
  const toDate = to ? new Date(String(to).slice(0, 10)) : null

  const dateWhere = fromDate && toDate
    ? {
        AND: [
          { startDate: { not: null } },
          { startDate: { lte: toDate } },
          { endDate: { not: null } },
          { endDate: { gte: fromDate } },
        ],
      }
    : {}

  const statusWhere = status !== undefined ? { statusCode: parseInt(String(status), 10) } : {}

  if (detailed === 'true') {
    const plans = await db.plan.findMany({
      where: { ownerId, ...dateWhere, ...statusWhere },
      include: {
        template: { select: { name: true, defaultAccountId: true } },
        budgets: {
          include: {
            template: { select: { name: true, amount: true } },
            transactions: {
              select: {
                id: true, name: true, amount: true, plannedAmount: true, plannedOn: true, executedOn: true, dueDateConfig: true, type: true,
                fromAccount: { select: { type: true } },
                toAccount: { select: { type: true } },
                template: { select: { name: true, plannedAmount: true, dueDateConfig: true, fromAccount: { select: { type: true } }, toAccount: { select: { type: true } } } },
              },
            },
          },
          orderBy: { name: 'asc' },
        },
        transactions: {
          where: { budgetId: null },
          select: {
            id: true, name: true, amount: true, plannedAmount: true, plannedOn: true, executedOn: true, dueDateConfig: true, type: true,
            fromAccount: { select: { type: true } },
            toAccount: { select: { type: true } },
            template: { select: { name: true, plannedAmount: true, dueDateConfig: true, fromAccount: { select: { type: true } }, toAccount: { select: { type: true } } } },
          },
        },
      },
      orderBy: { startDate: 'desc' },
    })

    // Apply template inheritance: null own value falls back to template value
    const result = plans.map(({ template: planTpl, budgets, transactions, ...plan }) => ({
      ...plan,
      name: plan.name ?? planTpl?.name ?? null,
      defaultAccountId: plan.defaultAccountId ?? planTpl?.defaultAccountId ?? null,
      budgets: budgets.map(({ template: budgetTpl, transactions: txs, ...budget }) => ({
        ...budget,
        name: budget.name ?? budgetTpl?.name ?? null,
        amount: budget.amount ?? budgetTpl?.amount ?? null,
        transactions: txs.map(({ template: txTpl, ...tx }) => ({
          ...tx,
          name: tx.name ?? txTpl?.name ?? null,
          plannedAmount: tx.plannedAmount ?? txTpl?.plannedAmount ?? null,
          dueDateConfig: tx.dueDateConfig ?? txTpl?.dueDateConfig ?? null,
          fromAccount: tx.fromAccount ?? txTpl?.fromAccount ?? null,
          toAccount: tx.toAccount ?? txTpl?.toAccount ?? null,
        })),
      })),
      transactions: transactions.map(({ template: txTpl, ...tx }) => ({
        ...tx,
        name: tx.name ?? txTpl?.name ?? null,
        plannedAmount: tx.plannedAmount ?? txTpl?.plannedAmount ?? null,
        dueDateConfig: tx.dueDateConfig ?? txTpl?.dueDateConfig ?? null,
        fromAccount: tx.fromAccount ?? txTpl?.fromAccount ?? null,
        toAccount: tx.toAccount ?? txTpl?.toAccount ?? null,
      })),
    }))

    res.json(result)
    return
  }

  const rawPlans = await db.plan.findMany({
    where: { ownerId, ...dateWhere, ...statusWhere },
    include: {
      template: { select: { name: true, defaultAccountId: true } },
      budgets: true,
    },
    orderBy: { startDate: 'desc' },
  })
  const plans = rawPlans.map(({ template, ...plan }) => ({
    ...plan,
    name: plan.name ?? template?.name ?? null,
    defaultAccountId: plan.defaultAccountId ?? template?.defaultAccountId ?? null,
  }))
  res.json(plans)
})

// GET /api/plans/:id
plansRouter.get('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const plan = await db.plan.findFirst({
    where: { id, ownerId: req.user!.sub },
    include: { budgets: true },
  })
  if (!plan) { res.status(404).json({ error: 'Not found' }); return }
  res.json(plan)
})

// POST /api/plans
plansRouter.post('/', async (req: AuthenticatedRequest, res) => {
  const { id, name, startDate, endDate, intervalType, isTemplate, templateId, defaultAccountId, recurrenceConfig, stateCode, statusCode } = req.body
  const plan = await db.plan.create({
    data: { ...(id ? { id } : {}), name, startDate: startDate ? new Date(startDate) : null, endDate: endDate ? new Date(endDate) : null, intervalType, isTemplate, templateId, defaultAccountId, recurrenceConfig, stateCode, statusCode, ownerId: req.user!.sub },
  })
  res.status(201).json(plan)
})

// PATCH /api/plans/:id
plansRouter.patch('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const existing = await db.plan.findFirst({
    where: { id, ownerId: req.user!.sub },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  const { name, startDate, endDate, intervalType, isTemplate, templateId, defaultAccountId, recurrenceConfig, stateCode, statusCode } = req.body
  const plan = await db.plan.update({
    where: { id },
    data: {
      name,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      intervalType,
      isTemplate,
      templateId,
      defaultAccountId,
      recurrenceConfig,
      stateCode,
      statusCode,
    },
  })
  res.json(plan)
})

// DELETE /api/plans/:id
plansRouter.delete('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const existing = await db.plan.findFirst({
    where: { id, ownerId: req.user!.sub },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  await db.plan.delete({ where: { id } })
  res.status(204).end()
})
