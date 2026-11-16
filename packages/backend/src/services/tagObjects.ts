import type { Prisma } from '@prisma/client'
import { sortByName } from './sortNames.js'

export type TagObjectType = 'transaction' | 'plan' | 'budget' | 'account'

export const isTagObjectType = (v: string): v is TagObjectType =>
  v === 'transaction' || v === 'plan' || v === 'budget' || v === 'account'

// The TagObject column that points at each kind of object
const targetOf = (type: TagObjectType, id: string) => ({
  transaction: { transactionId: id },
  plan: { planId: id },
  budget: { budgetId: id },
  account: { accountId: id },
})[type]

/** True when the object exists and belongs to the user. */
export async function ownsObject(client: Prisma.TransactionClient, type: TagObjectType, id: string, ownerId: string): Promise<boolean> {
  switch (type) {
    case 'transaction':
      return !!(await client.transaction.findFirst({ where: { id, OR: [{ budget: { plan: { ownerId } } }, { plan: { ownerId } }] }, select: { id: true } }))
    case 'plan':
      return !!(await client.plan.findFirst({ where: { id, ownerId }, select: { id: true } }))
    case 'budget':
      return !!(await client.budget.findFirst({ where: { id, plan: { ownerId } }, select: { id: true } }))
    case 'account':
      return !!(await client.account.findFirst({ where: { id, ownerId }, select: { id: true } }))
  }
}

export async function listObjectTags(client: Prisma.TransactionClient, type: TagObjectType, id: string) {
  return sortByName(await client.tag.findMany({ where: { objects: { some: targetOf(type, id) } } }))
}

/** Distinct tags of all given objects the owner owns, including those of the template a plan or budget is based on. */
export async function listUnionTags(client: Prisma.TransactionClient, objects: { type: TagObjectType; id: string }[], ownerId: string) {
  const checks = await Promise.all(objects.map((o) => ownsObject(client, o.type, o.id, ownerId)))
  const owned = objects.filter((_, i) => checks[i])
  const planIds = owned.filter((o) => o.type === 'plan').map((o) => o.id)
  const budgetIds = owned.filter((o) => o.type === 'budget').map((o) => o.id)
  const [plans, budgets] = await Promise.all([
    client.plan.findMany({ where: { id: { in: planIds }, templateId: { not: null } }, select: { templateId: true } }),
    client.budget.findMany({ where: { id: { in: budgetIds }, templateId: { not: null } }, select: { templateId: true } }),
  ])
  const targets = [
    ...owned.map((o) => targetOf(o.type, o.id)),
    ...plans.map((p) => targetOf('plan', p.templateId!)),
    ...budgets.map((b) => targetOf('budget', b.templateId!)),
  ]
  if (targets.length === 0) return []
  return sortByName(await client.tag.findMany({
    where: { ownerId, objects: { some: { OR: targets } } },
  }))
}

/** Makes the object's tags equal to tagIds (own tags only); a missing tagIds leaves them untouched. */
export async function replaceObjectTags(client: Prisma.TransactionClient, type: TagObjectType, id: string, ownerId: string, tagIds: unknown) {
  if (!Array.isArray(tagIds)) return
  const own = await client.tag.findMany({ where: { ownerId, id: { in: tagIds.map(String) } }, select: { id: true } })
  const ids = own.map((t) => t.id)
  const target = targetOf(type, id)
  await client.tagObject.deleteMany({ where: { ...target, tagId: { notIn: ids } } })
  await client.tagObject.createMany({ data: ids.map((tagId) => ({ ...target, tagId })), skipDuplicates: true })
}
