import { Router } from 'express'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { completePlanBudgets, freezeInheritedValues } from '../services/freezeInheritedValues.js'
import { deletePlanTree } from '../services/deletePlan.js'
import { activateDraft, changeRecurrence, getRecurrenceInfo, RecurrenceError } from '../services/recurrence.js'

export const plansRouter = Router()

// GET /api/plans?from=ISO&to=ISO&detailed=true&status=1&templateId=xxx&isTemplate=true
plansRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const { from, to, detailed, status, templateId, isTemplate } = req.query
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

  const statusWhere = {
    ...(status !== undefined ? { statusCode: parseInt(String(status), 10) } : {}),
    ...(templateId ? { templateId: String(templateId) } : {}),
    ...(isTemplate !== undefined ? { isTemplate: isTemplate === 'true' } : {}),
  }

  if (detailed === 'true') {
    const plans = await db.plan.findMany({
      where: { ownerId, ...dateWhere, ...statusWhere },
      include: {
        template: { select: { name: true, defaultAccountId: true, intervalType: true } },
        budgets: {
          include: {
            template: { select: { name: true, amount: true } },
            transactions: {
              select: {
                id: true, name: true, amount: true, plannedAmount: true, plannedOn: true, executedOn: true, dueDateConfig: true, type: true, templateId: true,
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
            id: true, name: true, amount: true, plannedAmount: true, plannedOn: true, executedOn: true, dueDateConfig: true, type: true, templateId: true,
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
      // Instances are stored as ONE_TIME; the recurrence comes from their template
      templateIntervalType: planTpl?.intervalType ?? null,
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
      template: { select: { name: true, defaultAccountId: true, intervalType: true } },
      budgets: true,
    },
    orderBy: { startDate: 'desc' },
  })
  const plans = rawPlans.map(({ template, ...plan }) => ({
    ...plan,
    name: plan.name ?? template?.name ?? null,
    defaultAccountId: plan.defaultAccountId ?? template?.defaultAccountId ?? null,
    templateIntervalType: template?.intervalType ?? null,
  }))
  res.json(plans)
})

// GET /api/plans/:id
plansRouter.get('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const txSelect = {
    id: true, name: true, amount: true, plannedAmount: true, plannedOn: true, executedOn: true, fromAccountId: true, toAccountId: true,
    planId: true, budgetId: true, type: true, stateCode: true, statusCode: true, templateId: true,
    dueDateConfig: true,
    template: { select: { name: true, plannedAmount: true, plannedOn: true, fromAccountId: true, toAccountId: true, dueDateConfig: true } },
    fromAccount: { select: { id: true, name: true, type: true } },
    toAccount: { select: { id: true, name: true, type: true } },
  }
  const plan = await db.plan.findFirst({
    where: { id, ownerId: req.user!.sub },
    include: {
      template: { select: { id: true, name: true, defaultAccountId: true } },
      budgets: {
        include: {
          template: { select: { id: true, name: true, amount: true, defaultAccountId: true } },
          transactions: { select: txSelect, orderBy: { plannedAmount: 'desc' } },
        },
        orderBy: { name: 'asc' },
      },
      transactions: { where: { budgetId: null }, select: txSelect, orderBy: { plannedAmount: 'desc' } },
    },
  })
  if (!plan) { res.status(404).json({ error: 'Not found' }); return }
  res.json(plan)
})

// POST /api/plans
plansRouter.post('/', async (req: AuthenticatedRequest, res) => {
  const { id, name, startDate, endDate, intervalType, isTemplate, templateId, defaultAccountId, recurrenceConfig, stateCode, statusCode } = req.body
  const plan = await db.plan.create({
    data: { ...(id ? { id } : {}), name, startDate: startDate ? new Date(startDate) : null, endDate: endDate ? new Date(endDate) : null, intervalType, isTemplate, templateId, defaultAccountId, recurrenceConfig, stateCode, statusCode: statusCode ?? (isTemplate ? 0 : undefined), ownerId: req.user!.sub },
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
  const plan = await db.$transaction(async (tx) => {
    const updated = await tx.plan.update({
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
    // Completed history must not change when the template does
    if (updated.statusCode === 3 && existing.statusCode !== 3) {
      if (updated.stateCode !== 1) await tx.plan.update({ where: { id }, data: { stateCode: 1 } })
      await completePlanBudgets(tx, [id])
      await freezeInheritedValues(tx, [id])
    }
    return tx.plan.findUniqueOrThrow({ where: { id } })
  })
  res.json(plan)
})

// GET /api/plans/:id/recurrence  (id may be a recurring template or one of its instances)
plansRouter.get('/:id/recurrence', async (req: AuthenticatedRequest, res, next) => {
  try {
    res.json(await getRecurrenceInfo(String(req.params.id), req.user!.sub))
  } catch (err) {
    if (err instanceof RecurrenceError) { res.status(err.status).json({ error: err.message }); return }
    next(err)
  }
})

// POST /api/plans/:id/recurrence  body: { mode: 'count', count } | { mode: 'until', until: 'YYYY-MM-DD' }
plansRouter.post('/:id/recurrence', async (req: AuthenticatedRequest, res, next) => {
  const { mode, count, until } = req.body ?? {}
  if (mode !== 'count' && mode !== 'until') { res.status(400).json({ error: 'mode must be "count" or "until"' }); return }
  try {
    const change = mode === 'count' ? { mode, count: Number(count) } as const : { mode, until: String(until) } as const
    res.json(await changeRecurrence(String(req.params.id), req.user!.sub, change))
  } catch (err) {
    if (err instanceof RecurrenceError) { res.status(err.status).json({ error: err.message }); return }
    next(err)
  }
})

// POST /api/plans/:id/activate  Draft -> Active/Scheduled; see activateDraft for the body
plansRouter.post('/:id/activate', async (req: AuthenticatedRequest, res, next) => {
  try {
    res.json(await activateDraft(String(req.params.id), req.user!.sub, req.body ?? {}))
  } catch (err) {
    if (err instanceof RecurrenceError) { res.status(err.status).json({ error: err.message }); return }
    next(err)
  }
})

// DELETE /api/plans/:id
plansRouter.delete('/:id', async (req: AuthenticatedRequest, res, next) => {
  const id = String(req.params.id)
  const existing = await db.plan.findFirst({
    where: { id, ownerId: req.user!.sub },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  try {
    const deleted = await db.$transaction(async (tx) => {
      // Instances are detached by the FK, so keep what they inherited from this template
      if (existing.isTemplate) {
        const instances = await tx.plan.findMany({ where: { templateId: id }, select: { id: true } })
        await freezeInheritedValues(tx, instances.map((i) => i.id))
      }
      return deletePlanTree(tx, id)
    })
    if (!deleted) { res.status(409).json({ error: 'Plan has executed transactions and cannot be deleted' }); return }
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})
