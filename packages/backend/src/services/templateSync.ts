import type { Budget, Prisma, Transaction } from '@prisma/client'

type Client = Prisma.TransactionClient

// Active and Scheduled instances follow template changes; Completed ones are frozen.
const LIVE_PLAN = { isTemplate: false, statusCode: { in: [1, 2] } }

type TxWithTemplate = Transaction & { template: Transaction | null; _count: { tags: number } }
type BudgetWithTemplate = Budget & { template: Budget | null }

const txInclude = { template: true, _count: { select: { tags: true } } } as const

/** True when the instance carries anything of its own instead of inheriting it. */
function txOverridden(t: TxWithTemplate): boolean {
  return [t.name, t.amount, t.plannedAmount, t.plannedOn, t.executedOn, t.dueDateConfig, t.fromAccountId, t.toAccountId, t.bankTicketId]
    .some((v) => v !== null) || t._count.tags > 0
}

function budgetOverridden(b: Budget): boolean {
  return b.name !== null || b.amount !== null || b.defaultAccountId !== null
}

async function freezeTransaction(tx: Client, t: TxWithTemplate) {
  const tpl = t.template
  await tx.transaction.update({
    where: { id: t.id },
    data: {
      name: t.name ?? tpl?.name,
      plannedAmount: t.plannedAmount ?? tpl?.plannedAmount,
      plannedOn: t.plannedOn ?? tpl?.plannedOn,
      dueDateConfig: t.dueDateConfig ?? tpl?.dueDateConfig,
      fromAccountId: t.fromAccountId ?? tpl?.fromAccountId,
      toAccountId: t.toAccountId ?? tpl?.toAccountId,
    },
  })
}

async function freezeBudget(tx: Client, b: BudgetWithTemplate) {
  await tx.budget.update({
    where: { id: b.id },
    data: {
      name: b.name ?? b.template?.name,
      amount: b.amount ?? b.template?.amount,
      defaultAccountId: b.defaultAccountId ?? b.template?.defaultAccountId,
    },
  })
}

async function isTemplatePlan(tx: Client, planId: string | null | undefined): Promise<boolean> {
  if (!planId) return false
  return (await tx.plan.findUnique({ where: { id: planId }, select: { isTemplate: true } }))?.isTemplate === true
}

async function owningPlanId(tx: Client, t: Pick<Transaction, 'planId' | 'budgetId'>): Promise<string | null> {
  if (t.planId) return t.planId
  if (!t.budgetId) return null
  return (await tx.budget.findUnique({ where: { id: t.budgetId }, select: { planId: true } }))?.planId ?? null
}

export async function isTemplateTransaction(tx: Client, t: Pick<Transaction, 'planId' | 'budgetId'>): Promise<boolean> {
  return isTemplatePlan(tx, await owningPlanId(tx, t))
}

// ─── Creation ─────────────────────────────────────────────────────────────────

export async function propagateBudgetCreated(tx: Client, budget: Budget): Promise<void> {
  if (!(await isTemplatePlan(tx, budget.planId))) return
  const instances = await tx.plan.findMany({ where: { templateId: budget.planId, ...LIVE_PLAN }, select: { id: true, statusCode: true } })
  await tx.budget.createMany({
    data: instances.map((i) => ({ planId: i.id, templateId: budget.id, stateCode: 0, statusCode: i.statusCode })),
  })
}

export async function propagateTransactionCreated(tx: Client, t: Transaction): Promise<void> {
  const templatePlanId = await owningPlanId(tx, t)
  if (!templatePlanId || !(await isTemplatePlan(tx, templatePlanId))) return
  const instances = await tx.plan.findMany({ where: { templateId: templatePlanId, ...LIVE_PLAN }, select: { id: true, statusCode: true } })

  const budgetByPlan = new Map<string, string>()
  if (t.budgetId) {
    const budgets = await tx.budget.findMany({ where: { templateId: t.budgetId, planId: { in: instances.map((i) => i.id) } }, select: { id: true, planId: true } })
    for (const b of budgets) budgetByPlan.set(b.planId, b.id)
  }

  const data = instances.flatMap((i) => {
    const budgetId = t.budgetId ? budgetByPlan.get(i.id) : null
    if (t.budgetId && !budgetId) return []
    return [{ planId: t.planId ? i.id : null, budgetId: budgetId ?? null, templateId: t.id, type: t.type, stateCode: 0, statusCode: i.statusCode }]
  })
  await tx.transaction.createMany({ data })
}

// ─── Deletion (call before deleting the template record itself) ───────────────

/** Removes untouched instance transactions; overridden ones keep their effective values and are detached. */
export async function removeTemplateTransaction(tx: Client, templateTx: Transaction): Promise<void> {
  const instances = await tx.transaction.findMany({
    where: { templateId: templateTx.id, OR: [{ plan: LIVE_PLAN }, { budget: { plan: LIVE_PLAN } }] },
    include: txInclude,
  })
  for (const instance of instances) {
    if (txOverridden(instance)) await freezeTransaction(tx, instance)
    else await tx.transaction.delete({ where: { id: instance.id } })
  }
}

/**
 * Removes instance budgets that are untouched and hold only untouched template-based transactions.
 * Any other instance budget keeps its effective values and those of its transactions.
 * The caller then deletes the template budget's own transactions and the budget.
 */
export async function removeTemplateBudget(tx: Client, templateBudget: Budget): Promise<void> {
  const instances = await tx.budget.findMany({
    where: { templateId: templateBudget.id, plan: LIVE_PLAN },
    include: { template: true, transactions: { include: txInclude } },
  })
  for (const instance of instances) {
    const removable = !budgetOverridden(instance) && instance.transactions.every((c) => c.templateId !== null && !txOverridden(c))
    if (removable) {
      await tx.transaction.deleteMany({ where: { budgetId: instance.id } })
      await tx.budget.delete({ where: { id: instance.id } })
      continue
    }
    for (const child of instance.transactions) if (child.templateId !== null) await freezeTransaction(tx, child)
    await freezeBudget(tx, instance)
  }
}
