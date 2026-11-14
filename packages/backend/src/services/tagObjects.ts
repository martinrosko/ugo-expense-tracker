import type { Prisma } from '@prisma/client'

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

export function listObjectTags(client: Prisma.TransactionClient, type: TagObjectType, id: string) {
  return client.tag.findMany({ where: { objects: { some: targetOf(type, id) } }, orderBy: { name: 'asc' } })
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
