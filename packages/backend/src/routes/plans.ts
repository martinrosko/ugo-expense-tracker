import { Router } from 'express'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { completePlanBudgets, freezeInheritedValues } from '../services/freezeInheritedValues.js'
import { deletePlanTree } from '../services/deletePlan.js'
import { activateDraft, changeRecurrence, getRecurrenceInfo, RecurrenceError } from '../services/recurrence.js'
import { compareNames } from '../services/sortNames.js'
import { canUseAccounts, loadViewer, planAccessWhere, viewForPlan, type PlanAccess } from '../services/access.js'

export const plansRouter = Router()

const ACCOUNT_REF = { id: true, name: true, type: true } as const

// The caller's membership of a plan or of the template it was generated from
const membership = (userId: string) => ({ where: { userId }, select: { role: true } }) as const

type Memberships = { ownerId: string; members: { role: string }[]; template?: { members: { role: string }[] } | null }
const roleOf = (plan: Memberships, userId: string): PlanAccess => {
  if (plan.ownerId === userId) return 'OWNER'
  const roles = [...plan.members, ...(plan.template?.members ?? [])].map((m) => m.role)
  return roles.includes('CONTRIBUTOR') ? 'CONTRIBUTOR' : 'VIEWER'
}

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
    const txSelect = {
      id: true, name: true, amount: true, plannedAmount: true, plannedOn: true, executedOn: true, dueDateConfig: true, type: true, templateId: true, bankTicketId: true, createdById: true,
      fromAccount: { select: ACCOUNT_REF },
      toAccount: { select: ACCOUNT_REF },
      template: { select: { name: true, plannedAmount: true, dueDateConfig: true, fromAccount: { select: ACCOUNT_REF }, toAccount: { select: ACCOUNT_REF } } },
    } as const
    const plans = await db.plan.findMany({
      where: { ...planAccessWhere(ownerId), ...dateWhere, ...statusWhere },
      include: {
        template: { select: { name: true, defaultAccountId: true, intervalType: true, members: membership(ownerId) } },
        members: membership(ownerId),
        budgets: {
          include: {
            template: { select: { name: true, amount: true } },
            transactions: { select: txSelect },
          },
        },
        transactions: { where: { budgetId: null }, select: txSelect },
      },
      orderBy: { startDate: 'desc' },
    })
    const viewer = await loadViewer(db, ownerId)

    // Apply template inheritance: null own value falls back to template value
    const result = plans.map(({ template: planTpl, budgets, transactions, members, ...plan }) => {
      const myRole = roleOf({ ownerId: plan.ownerId, members, template: planTpl }, ownerId)
      const edit = { role: myRole, isTemplate: plan.isTemplate }
      const merge = ({ template: txTpl, ...tx }: (typeof transactions)[number]) => ({
        ...tx,
        name: tx.name ?? txTpl?.name ?? null,
        plannedAmount: tx.plannedAmount ?? txTpl?.plannedAmount ?? null,
        dueDateConfig: tx.dueDateConfig ?? txTpl?.dueDateConfig ?? null,
        fromAccount: tx.fromAccount ?? txTpl?.fromAccount ?? null,
        toAccount: tx.toAccount ?? txTpl?.toAccount ?? null,
      })
      return {
        ...plan,
        myRole,
        name: plan.name ?? planTpl?.name ?? null,
        defaultAccountId: plan.defaultAccountId ?? planTpl?.defaultAccountId ?? null,
        // Instances are stored as ONE_TIME; the recurrence comes from their template
        templateIntervalType: planTpl?.intervalType ?? null,
        budgets: budgets.map(({ template: budgetTpl, transactions: txs, ...budget }) => ({
          ...budget,
          name: budget.name ?? budgetTpl?.name ?? null,
          amount: budget.amount ?? budgetTpl?.amount ?? null,
          transactions: viewForPlan(txs.map(merge), viewer, plan.ownerId, budget.id, edit),
        })).sort((a, b) => compareNames(a.name, b.name)),
        transactions: viewForPlan(transactions.map(merge), viewer, plan.ownerId, plan.id, edit),
      }
    })

    res.json(result)
    return
  }

  const rawPlans = await db.plan.findMany({
    where: { ...planAccessWhere(ownerId), ...dateWhere, ...statusWhere },
    include: {
      template: { select: { name: true, defaultAccountId: true, intervalType: true, members: membership(ownerId) } },
      members: membership(ownerId),
      budgets: true,
    },
    orderBy: { startDate: 'desc' },
  })
  const plans = rawPlans.map(({ template, members, ...plan }) => ({
    ...plan,
    myRole: roleOf({ ownerId: plan.ownerId, members, template }, ownerId),
    name: plan.name ?? template?.name ?? null,
    defaultAccountId: plan.defaultAccountId ?? template?.defaultAccountId ?? null,
    templateIntervalType: template?.intervalType ?? null,
  }))
  res.json(plans)
})

// GET /api/plans/:id
plansRouter.get('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const userId = req.user!.sub
  const txSelect = {
    id: true, name: true, amount: true, plannedAmount: true, plannedOn: true, executedOn: true, fromAccountId: true, toAccountId: true,
    planId: true, budgetId: true, type: true, stateCode: true, statusCode: true, templateId: true, bankTicketId: true, createdById: true,
    dueDateConfig: true,
    template: { select: { name: true, plannedAmount: true, plannedOn: true, fromAccountId: true, toAccountId: true, dueDateConfig: true, fromAccount: { select: ACCOUNT_REF }, toAccount: { select: ACCOUNT_REF } } },
    fromAccount: { select: ACCOUNT_REF },
    toAccount: { select: ACCOUNT_REF },
  } as const
  const plan = await db.plan.findFirst({
    where: { id, ...planAccessWhere(userId) },
    include: {
      template: { select: { id: true, name: true, defaultAccountId: true, members: membership(userId) } },
      members: membership(userId),
      budgets: {
        include: {
          template: { select: { id: true, name: true, amount: true, defaultAccountId: true } },
          transactions: { select: txSelect, orderBy: { plannedAmount: 'desc' } },
        },
      },
      transactions: { where: { budgetId: null }, select: txSelect, orderBy: { plannedAmount: 'desc' } },
    },
  })
  if (!plan) { res.status(404).json({ error: 'Not found' }); return }
  const viewer = await loadViewer(db, userId)
  const { members, template, budgets, transactions, ...rest } = plan
  const myRole = roleOf({ ownerId: plan.ownerId, members, template }, userId)
  const edit = { role: myRole, isTemplate: plan.isTemplate }
  budgets.sort((a, b) => compareNames(a.name ?? a.template?.name, b.name ?? b.template?.name))
  res.json({
    ...rest,
    myRole,
    template: template && { id: template.id, name: template.name, defaultAccountId: template.defaultAccountId },
    budgets: budgets.map((b) => ({ ...b, transactions: viewForPlan(b.transactions, viewer, plan.ownerId, b.id, edit) })),
    transactions: viewForPlan(transactions, viewer, plan.ownerId, plan.id, edit),
  })
})

// POST /api/plans
plansRouter.post('/', async (req: AuthenticatedRequest, res) => {
  const { id, name, startDate, endDate, intervalType, isTemplate, templateId, defaultAccountId, recurrenceConfig, stateCode, statusCode } = req.body
  if (!(await canUseAccounts(db, req.user!.sub, [defaultAccountId]))) { res.status(403).json({ error: 'Forbidden' }); return }
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
  if (!(await canUseAccounts(db, req.user!.sub, [defaultAccountId]))) { res.status(403).json({ error: 'Forbidden' }); return }
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

// ─── Members (owner only) ─────────────────────────────────────────────────────

const MEMBER_ROLES = ['VIEWER', 'CONTRIBUTOR']

const ownedPlan = (id: string, userId: string) => db.plan.findFirst({ where: { id, ownerId: userId }, select: { id: true } })

// GET /api/plans/:id/members
plansRouter.get('/:id/members', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  if (!(await ownedPlan(id, req.user!.sub))) { res.status(404).json({ error: 'Not found' }); return }
  const members = await db.planMember.findMany({ where: { planId: id }, include: { user: { select: { email: true, name: true } } }, orderBy: { createdAt: 'asc' } })
  res.json(members.map((m) => ({ userId: m.userId, email: m.user.email, name: m.user.name, role: m.role })))
})

// POST /api/plans/:id/members  body: { email, role: 'VIEWER' | 'CONTRIBUTOR' }  — adds or changes the member
plansRouter.post('/:id/members', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const { email, role } = req.body ?? {}
  if (!(await ownedPlan(id, req.user!.sub))) { res.status(404).json({ error: 'Not found' }); return }
  if (!MEMBER_ROLES.includes(role)) { res.status(400).json({ error: 'role must be VIEWER or CONTRIBUTOR' }); return }
  const user = typeof email === 'string' && email.trim()
    ? await db.user.findFirst({ where: { email: { equals: email.trim(), mode: 'insensitive' } } })
    : null
  if (!user) { res.status(404).json({ error: 'No user with this email. They must sign in once first.' }); return }
  if (user.id === req.user!.sub) { res.status(409).json({ error: 'You already own this plan' }); return }
  const member = await db.planMember.upsert({
    where: { planId_userId: { planId: id, userId: user.id } },
    create: { planId: id, userId: user.id, role },
    update: { role },
  })
  res.status(201).json({ userId: user.id, email: user.email, name: user.name, role: member.role })
})

// DELETE /api/plans/:id/members/:userId
plansRouter.delete('/:id/members/:userId', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  if (!(await ownedPlan(id, req.user!.sub))) { res.status(404).json({ error: 'Not found' }); return }
  await db.planMember.deleteMany({ where: { planId: id, userId: String(req.params.userId) } })
  res.status(204).end()
})
