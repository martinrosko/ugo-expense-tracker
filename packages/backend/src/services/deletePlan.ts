import type { Prisma } from '@prisma/client'

/** Deletes a plan with its budgets and transactions. Returns false (deleting nothing) if any transaction was executed. */
export async function deletePlanTree(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
  const budgetIds = (await tx.budget.findMany({ where: { planId: id }, select: { id: true } })).map((b) => b.id)
  const ownTransactions = { OR: [{ planId: id }, { budgetId: { in: budgetIds } }] }
  if (await tx.transaction.count({ where: { ...ownTransactions, executedOn: { not: null } } }) > 0) return false
  await tx.transactionTag.deleteMany({ where: { transaction: ownTransactions } })
  await tx.transaction.deleteMany({ where: ownTransactions })
  await tx.budget.deleteMany({ where: { planId: id } })
  await tx.plan.delete({ where: { id } })
  return true
}
