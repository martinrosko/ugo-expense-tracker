// One-off: copies template transactions that live instances are missing (e.g. added before template sync existed).
// Dry run by default. Run from packages/backend:
//   node --env-file=.env --import tsx scripts/syncTemplateInstances.mts [--apply]
import { PrismaClient } from '@prisma/client'

const apply = process.argv.includes('--apply')
const db = new PrismaClient()

const templates = await db.plan.findMany({ where: { isTemplate: true, intervalType: { not: 'ONE_TIME' } }, select: { id: true, name: true } })
let missing = 0

for (const tpl of templates) {
  const tplTxs = await db.transaction.findMany({
    // Same filter as new instances use: ended (status 3) or inactive template transactions are not copied
    where: { stateCode: 0, statusCode: { not: 3 }, OR: [{ planId: tpl.id }, { budget: { planId: tpl.id } }] },
    select: { id: true, name: true, type: true, planId: true, budgetId: true },
  })
  // Active and Scheduled instances follow the template; Completed ones are frozen
  const instances = await db.plan.findMany({
    where: { templateId: tpl.id, isTemplate: false, statusCode: { in: [1, 2] } },
    select: { id: true, statusCode: true, startDate: true, budgets: { select: { id: true, templateId: true } } },
    orderBy: { startDate: 'asc' },
  })

  for (const inst of instances) {
    const have = new Set(
      (await db.transaction.findMany({
        where: { templateId: { in: tplTxs.map((t) => t.id) }, OR: [{ planId: inst.id }, { budget: { planId: inst.id } }] },
        select: { templateId: true },
      })).map((t) => t.templateId),
    )
    const data = tplTxs.flatMap((t) => {
      if (have.has(t.id)) return []
      if (!apply) console.log('    +', t.name, t.budgetId ? '(budget)' : '(plan)', t.id.slice(0, 8))
      const budgetId = t.budgetId ? inst.budgets.find((b) => b.templateId === t.budgetId)?.id : null
      if (t.budgetId && !budgetId) {
        console.log(`  skipped "${t.name}": ${inst.startDate?.toISOString().slice(0, 10)} has no budget linked to its template budget`)
        return []
      }
      return [{ planId: t.budgetId ? null : inst.id, budgetId: budgetId ?? null, templateId: t.id, type: t.type, stateCode: 0, statusCode: inst.statusCode }]
    })
    if (data.length === 0) continue
    missing += data.length
    console.log(`${tpl.name ?? tpl.id} ${inst.startDate?.toISOString().slice(0, 10)}: ${apply ? 'creating' : 'would create'} ${data.length}`)
    if (apply) await db.transaction.createMany({ data })
  }
}

console.log(`${apply ? 'Created' : 'Would create'} ${missing} transaction(s).${apply ? '' : ' Run with --apply to write them.'}`)
await db.$disconnect()


