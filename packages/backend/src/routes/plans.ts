import { Router } from 'express'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

export const plansRouter = Router()

// GET /api/plans
plansRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const plans = await db.plan.findMany({
    where: { ownerId: req.user!.sub },
    include: { budgets: true },
    orderBy: { startDate: 'desc' },
  })
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
