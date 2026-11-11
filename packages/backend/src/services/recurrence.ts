import { randomUUID } from 'node:crypto'
import type { Plan, Prisma } from '@prisma/client'
import db from '../db.js'
import { deletePlanTree } from './deletePlan.js'

export type RecurringInterval = 'WEEKLY' | 'MONTHLY' | 'YEARLY'

const DAY_MS = 86_400_000
const MAX_NEW_INSTANCES = 600

export class RecurrenceError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

// ─── Date helpers (plan dates are UTC-midnight @db.Date values) ───────────────

function zoneParts(ms: number, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(ms)
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

/** Calendar date of an instant in the given timezone, as a UTC-midnight Date. */
function localDate(instant: Date, tz: string): Date {
  const p = zoneParts(instant.getTime(), tz)
  return new Date(Date.UTC(p.year, p.month - 1, p.day))
}

/** The instant at which the given calendar date starts in the timezone. */
function zonedMidnight(date: Date, tz: string): Date {
  const target = date.getTime()
  let t = target
  for (let i = 0; i < 2; i++) {
    const p = zoneParts(t, tz)
    t = target - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t)
  }
  return new Date(t)
}

function periodStart(interval: RecurringInterval, d: Date): Date {
  if (interval === 'WEEKLY') return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS)
  if (interval === 'MONTHLY') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
}

function addPeriods(interval: RecurringInterval, start: Date, n: number): Date {
  if (interval === 'WEEKLY') return new Date(start.getTime() + n * 7 * DAY_MS)
  if (interval === 'MONTHLY') return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + n, 1))
  return new Date(Date.UTC(start.getUTCFullYear() + n, 0, 1))
}

function periodEnd(interval: RecurringInterval, start: Date): Date {
  return new Date(addPeriods(interval, start, 1).getTime() - DAY_MS)
}

const dateStr = (d: Date) => d.toISOString().slice(0, 10)

// ─── Recurrence config ────────────────────────────────────────────────────────

type RecurrenceConfig = { startDate?: string; repeatEvery?: number; endDate?: string }

function parseConfig(raw: string | null): RecurrenceConfig {
  if (!raw) return {}
  try {
    const cfg = JSON.parse(raw) as RecurrenceConfig
    return cfg && typeof cfg === 'object' ? cfg : {}
  } catch {
    return {}
  }
}

const repeatEveryOf = (cfg: RecurrenceConfig) => (Number.isInteger(cfg.repeatEvery) && cfg.repeatEvery! >= 1 ? cfg.repeatEvery! : 1)

// ─── Context ──────────────────────────────────────────────────────────────────

type Context = {
  template: Plan
  interval: RecurringInterval
  tz: string
  config: RecurrenceConfig
  repeatEvery: number
  currentStart: Date
}

async function loadContext(planId: string, ownerId: string): Promise<Context> {
  const plan = await db.plan.findFirst({ where: { id: planId, ownerId } })
  if (!plan) throw new RecurrenceError(404, 'Not found')
  const template = plan.isTemplate ? plan : plan.templateId ? await db.plan.findFirst({ where: { id: plan.templateId, ownerId } }) : null
  if (!template) throw new RecurrenceError(400, 'Plan has no template')
  if (template.intervalType === 'ONE_TIME') throw new RecurrenceError(400, 'Plan is not recurring')
  const interval = template.intervalType as RecurringInterval
  const user = await db.user.findUnique({ where: { id: ownerId }, select: { timezone: true } })
  const tz = user?.timezone ?? 'UTC'
  const config = parseConfig(template.recurrenceConfig)
  return { template, interval, tz, config, repeatEvery: repeatEveryOf(config), currentStart: periodStart(interval, localDate(new Date(), tz)) }
}

function instancesOf(client: Prisma.TransactionClient | typeof db, templateId: string) {
  return client.plan.findMany({
    where: { templateId, isTemplate: false, statusCode: { not: 4 }, startDate: { not: null } },
    select: { id: true, startDate: true, statusCode: true },
    orderBy: { startDate: 'asc' },
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getRecurrenceInfo(planId: string, ownerId: string) {
  const ctx = await loadContext(planId, ownerId)
  const instances = await instancesOf(db, ctx.template.id)
  const configured = (iso?: string) => {
    const instant = iso ? new Date(iso) : null
    return instant && !isNaN(instant.getTime()) ? periodStart(ctx.interval, localDate(instant, ctx.tz)) : null
  }
  const first = configured(ctx.config.startDate) ?? instances[0]?.startDate ?? null
  const end = configured(ctx.config.endDate)
  const last = instances[instances.length - 1]?.startDate ?? null
  return {
    templateId: ctx.template.id,
    templateName: ctx.template.name,
    intervalType: ctx.interval,
    repeatEvery: ctx.repeatEvery,
    firstPeriodStart: first && dateStr(first),
    endPeriodStart: end && dateStr(end),
    currentPeriodStart: dateStr(ctx.currentStart),
    lastScheduledPeriodStart: last && dateStr(last),
    futureCount: instances.filter((i) => i.startDate! > ctx.currentStart).length,
  }
}

export type RecurrenceChange = { mode: 'count'; count: number } | { mode: 'until'; until: string }

/** Moves the end of the recurrence: deletes scheduled instances past it or adds scheduled placeholders up to it. */
export async function changeRecurrence(planId: string, ownerId: string, change: RecurrenceChange) {
  const ctx = await loadContext(planId, ownerId)
  const { interval, template, currentStart, repeatEvery, tz } = ctx

  let lastStart: Date
  if (change.mode === 'count') {
    if (!Number.isInteger(change.count) || change.count < 0) throw new RecurrenceError(400, 'count must be a non-negative integer')
    lastStart = addPeriods(interval, currentStart, change.count * repeatEvery)
  } else {
    const until = new Date(`${String(change.until).slice(0, 10)}T00:00:00.000Z`)
    if (isNaN(until.getTime())) throw new RecurrenceError(400, 'Invalid until date')
    lastStart = periodStart(interval, until)
    if (lastStart < currentStart) throw new RecurrenceError(400, 'The recurrence can only end in the current period or later')
  }

  return db.$transaction(async (tx) => {
    const instances = await instancesOf(tx, template.id)

    let deleted = 0
    for (const instance of instances) {
      if (instance.startDate! <= lastStart) continue
      if (instance.statusCode !== 2) continue
      if (!(await deletePlanTree(tx, instance.id))) throw new RecurrenceError(409, 'A future plan has executed transactions and cannot be removed')
      deleted++
    }

    const remaining = instances.filter((i) => i.startDate! >= currentStart && i.startDate! <= lastStart)
    const cursor = remaining.reduce((max, i) => (i.startDate! > max ? i.startDate! : max), currentStart)
    const starts: Date[] = []
    for (let next = addPeriods(interval, cursor, repeatEvery); next <= lastStart; next = addPeriods(interval, next, repeatEvery)) {
      starts.push(next)
      if (starts.length > MAX_NEW_INSTANCES) throw new RecurrenceError(400, 'Too many plans would be created; choose a nearer end')
    }

    const created = await createPlaceholders(tx, template, starts)

    // Stored as the local start of the last period, matching how the config is read back
    const config = { ...ctx.config, repeatEvery, endDate: zonedMidnight(lastStart, tz).toISOString() }
    await tx.plan.update({ where: { id: template.id }, data: { recurrenceConfig: JSON.stringify(config) } })

    return { created, deleted, endPeriodStart: dateStr(lastStart) }
  })
}

// Placeholders are Scheduled (statusCode 2, stateCode 0) at every level, except the one starting at activeStart, which is Active (1).
async function createPlaceholders(tx: Prisma.TransactionClient, template: Plan, starts: Date[], activeStart: Date | null = null): Promise<number> {
  if (starts.length === 0) return 0
  const interval = template.intervalType as RecurringInterval
  const budgets = await tx.budget.findMany({ where: { planId: template.id, stateCode: 0, statusCode: { not: 3 } } })
  const transactions = await tx.transaction.findMany({
    where: {
      stateCode: 0,
      statusCode: { not: 3 },
      OR: [{ planId: template.id }, { budgetId: { in: budgets.map((b) => b.id) } }],
    },
  })

  for (const start of starts) {
    const statusCode = activeStart && start.getTime() === activeStart.getTime() ? 1 : 2
    const planId = randomUUID()
    const budgetIds = new Map(budgets.map((b) => [b.id, randomUUID()]))
    await tx.plan.create({
      data: {
        id: planId,
        startDate: start,
        endDate: periodEnd(interval, start),
        intervalType: template.intervalType,
        isTemplate: false,
        templateId: template.id,
        stateCode: 0,
        statusCode,
        ownerId: template.ownerId,
      },
    })
    await tx.budget.createMany({
      data: budgets.map((b) => ({ id: budgetIds.get(b.id)!, planId, templateId: b.id, stateCode: 0, statusCode })),
    })
    await tx.transaction.createMany({
      data: transactions.map((t) => ({
        planId: t.planId ? planId : null,
        budgetId: t.budgetId ? budgetIds.get(t.budgetId) ?? null : null,
        templateId: t.id,
        type: t.type,
        stateCode: 0,
        statusCode,
      })),
    })
  }
  return starts.length
}

// ─── Draft activation ─────────────────────────────────────────────────────────

function parseDay(value: unknown, field: string): Date {
  const text = String(value ?? '').slice(0, 10)
  const d = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00.000Z`) : null
  if (!d || isNaN(d.getTime())) throw new RecurrenceError(400, `Invalid ${field}`)
  return d
}

/**
 * Activates a Draft plan.
 * Recurring template body: { repeatEvery, startPeriod, mode: 'count', count } | { ..., mode: 'until', until }
 * One-time plan body: { startDate, endDate }. Dates are YYYY-MM-DD and must not be in the past.
 */
export async function activateDraft(planId: string, ownerId: string, body: Record<string, unknown>) {
  const plan = await db.plan.findFirst({ where: { id: planId, ownerId } })
  if (!plan) throw new RecurrenceError(404, 'Not found')
  if (plan.statusCode !== 0) throw new RecurrenceError(409, 'Only draft plans can be activated')
  const user = await db.user.findUnique({ where: { id: ownerId }, select: { timezone: true } })
  const tz = user?.timezone ?? 'UTC'
  const today = localDate(new Date(), tz)

  if (plan.intervalType === 'ONE_TIME') return activateOneTime(plan, today, body)
  if (!plan.isTemplate) throw new RecurrenceError(400, 'Only recurring templates can be activated as recurring')
  return activateRecurring(plan, tz, today, body)
}

async function activateOneTime(plan: Plan, today: Date, body: Record<string, unknown>) {
  const startDate = parseDay(body.startDate, 'startDate')
  const endDate = parseDay(body.endDate, 'endDate')
  if (startDate < today) throw new RecurrenceError(400, 'The start date cannot be in the past')
  if (endDate < startDate) throw new RecurrenceError(400, 'The end date cannot be before the start date')
  const statusCode = startDate.getTime() === today.getTime() ? 1 : 2

  await db.$transaction(async (tx) => {
    // A one-time plan stops being a template: it is the plan itself and follows the status job
    await tx.plan.update({ where: { id: plan.id }, data: { isTemplate: false, startDate, endDate, statusCode, stateCode: 0 } })
    await tx.budget.updateMany({ where: { planId: plan.id, statusCode: 0 }, data: { statusCode } })
    await tx.transaction.updateMany({ where: { statusCode: 0, OR: [{ planId: plan.id }, { budget: { planId: plan.id } }] }, data: { statusCode } })
  })
  return { statusCode, created: 0 }
}

async function activateRecurring(template: Plan, tz: string, today: Date, body: Record<string, unknown>) {
  const interval = template.intervalType as RecurringInterval
  const repeatEvery = Number(body.repeatEvery)
  if (!Number.isInteger(repeatEvery) || repeatEvery < 1 || repeatEvery > 1000) throw new RecurrenceError(400, 'repeatEvery must be a positive integer')

  const currentStart = periodStart(interval, today)
  const first = periodStart(interval, parseDay(body.startPeriod, 'startPeriod'))
  if (first < currentStart) throw new RecurrenceError(400, 'The first period cannot be in the past')
  if (first.getUTCFullYear() - currentStart.getUTCFullYear() > 50) {
    throw new RecurrenceError(400, 'The first period is too far ahead')
  }

  let lastStart: Date
  if (body.mode === 'count') {
    const count = Number(body.count)
    if (!Number.isInteger(count) || count < 0) throw new RecurrenceError(400, 'count must be a non-negative integer')
    lastStart = addPeriods(interval, first, count * repeatEvery)
  } else if (body.mode === 'until') {
    lastStart = periodStart(interval, parseDay(body.until, 'until'))
    if (lastStart < first) throw new RecurrenceError(400, 'The end cannot be before the first period')
  } else {
    throw new RecurrenceError(400, 'mode must be "count" or "until"')
  }

  const starts: Date[] = []
  for (let next = first; next <= lastStart; next = addPeriods(interval, next, repeatEvery)) {
    starts.push(next)
    if (starts.length > MAX_NEW_INSTANCES) throw new RecurrenceError(400, 'Too many plans would be created; choose a nearer end')
  }

  return db.$transaction(async (tx) => {
    await tx.budget.updateMany({ where: { planId: template.id, statusCode: 0 }, data: { statusCode: 1 } })
    await tx.transaction.updateMany({ where: { statusCode: 0, OR: [{ planId: template.id }, { budget: { planId: template.id } }] }, data: { statusCode: 1 } })

    const created = await createPlaceholders(tx, template, starts, currentStart)

    const config = {
      startDate: zonedMidnight(first, tz).toISOString(),
      repeatEvery,
      endDate: zonedMidnight(starts[starts.length - 1], tz).toISOString(),
    }
    await tx.plan.update({ where: { id: template.id }, data: { statusCode: 1, stateCode: 0, recurrenceConfig: JSON.stringify(config) } })
    return { statusCode: 1, created }
  })
}