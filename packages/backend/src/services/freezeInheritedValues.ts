import type { Prisma } from '@prisma/client'
import { isRecurringInterval, withPeriodSuffix } from './planLabel.js'

/** Marks all budgets of the given (just completed) plans as Completed + Inactive. */
export async function completePlanBudgets(client: Prisma.TransactionClient, planIds: string[]): Promise<void> {
  if (planIds.length === 0) return
  await client.budget.updateMany({
    where: { planId: { in: planIds }, OR: [{ statusCode: { not: 3 } }, { stateCode: { not: 1 } }] },
    data: { statusCode: 3, stateCode: 1 },
  })
}

/**
 * Copies template-inherited values (null in the instance) into the given plans, their budgets and
 * transactions, so later template edits no longer change them. Recurring plans also get their period
 * label stored in the name. Idempotent; never overwrites own values.
 */
export async function freezeInheritedValues(client: Prisma.TransactionClient, planIds: string[]): Promise<void> {
  if (planIds.length === 0) return

  await client.$executeRaw`
    UPDATE "Plan" p
    SET "name" = COALESCE(p."name", t."name"),
        "defaultAccountId" = COALESCE(p."defaultAccountId", t."defaultAccountId"),
        "recurrenceConfig" = COALESCE(p."recurrenceConfig", t."recurrenceConfig"),
        "intervalType" = t."intervalType",
        "updatedAt" = now()
    FROM "Plan" t
    WHERE p."templateId" = t."id"
      AND p."id" = ANY(${planIds}::text[])
      AND ((p."name" IS NULL AND t."name" IS NOT NULL)
        OR (p."defaultAccountId" IS NULL AND t."defaultAccountId" IS NOT NULL)
        OR (p."recurrenceConfig" IS NULL AND t."recurrenceConfig" IS NOT NULL)
        OR p."intervalType" IS DISTINCT FROM t."intervalType")`

  const recurring = await client.plan.findMany({
    where: { id: { in: planIds }, isTemplate: false, startDate: { not: null } },
    select: { id: true, name: true, startDate: true, intervalType: true, template: { select: { intervalType: true } } },
  })
  for (const plan of recurring) {
    // Instances are stored as ONE_TIME; the recurrence comes from their template
    const interval = plan.template?.intervalType ?? plan.intervalType
    if (!plan.name || !plan.startDate || !isRecurringInterval(interval)) continue
    const labeled = withPeriodSuffix(plan.name, interval, plan.startDate)
    if (labeled !== plan.name) await client.plan.update({ where: { id: plan.id }, data: { name: labeled } })
  }

  await client.$executeRaw`
    UPDATE "Budget" b
    SET "name" = COALESCE(b."name", t."name"),
        "amount" = COALESCE(b."amount", t."amount"),
        "defaultAccountId" = COALESCE(b."defaultAccountId", t."defaultAccountId"),
        "updatedAt" = now()
    FROM "Budget" t
    WHERE b."templateId" = t."id"
      AND b."planId" = ANY(${planIds}::text[])
      AND ((b."name" IS NULL AND t."name" IS NOT NULL)
        OR (b."amount" IS NULL AND t."amount" IS NOT NULL)
        OR (b."defaultAccountId" IS NULL AND t."defaultAccountId" IS NOT NULL))`

  await client.$executeRaw`
    UPDATE "Transaction" x
    SET "name" = COALESCE(x."name", t."name"),
        "plannedAmount" = COALESCE(x."plannedAmount", t."plannedAmount"),
        "plannedOn" = COALESCE(x."plannedOn", t."plannedOn"),
        "dueDateConfig" = COALESCE(x."dueDateConfig", t."dueDateConfig"),
        "fromAccountId" = COALESCE(x."fromAccountId", t."fromAccountId"),
        "toAccountId" = COALESCE(x."toAccountId", t."toAccountId"),
        "updatedAt" = now()
    FROM "Transaction" t
    WHERE x."templateId" = t."id"
      AND (x."planId" = ANY(${planIds}::text[])
        OR x."budgetId" IN (SELECT "id" FROM "Budget" WHERE "planId" = ANY(${planIds}::text[])))
      AND ((x."name" IS NULL AND t."name" IS NOT NULL)
        OR (x."plannedAmount" IS NULL AND t."plannedAmount" IS NOT NULL)
        OR (x."plannedOn" IS NULL AND t."plannedOn" IS NOT NULL)
        OR (x."dueDateConfig" IS NULL AND t."dueDateConfig" IS NOT NULL)
        OR (x."fromAccountId" IS NULL AND t."fromAccountId" IS NOT NULL)
        OR (x."toAccountId" IS NULL AND t."toAccountId" IS NOT NULL))`
}
