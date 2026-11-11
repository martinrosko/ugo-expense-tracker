import db from '../db.js'
import { completePlanBudgets, freezeInheritedValues } from '../services/freezeInheritedValues.js'

const SYNC_INTERVAL_MS = 15 * 60 * 1000
const ADVISORY_LOCK_ID = 727_001

// Without a stored timezone, be conservative: complete only once the plan ended everywhere (UTC-12),
// and activate as soon as it started anywhere (UTC+14). POSIX-style names have inverted signs.
const FALLBACK_COMPLETE_TZ = 'Etc/GMT+12'
const FALLBACK_ACTIVATE_TZ = 'Etc/GMT-14'

type SyncResult = { completed: number; activated: number }

/**
 * Moves plan instances Scheduled/Active -> Completed once their end date passed, and
 * Scheduled -> Active once in range, using "today" in each owner's timezone.
 * Idempotent, set-based, and guarded by a transaction-level advisory lock for multi-instance deployments.
 */
export async function syncPlanStatuses(): Promise<SyncResult | null> {
  return db.$transaction(async (tx) => {
    const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_ID}) AS locked`
    if (!locked) return null

    // Completion first, so an already-finished scheduled plan skips Active
    const completedRows = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "Plan" p
      SET "statusCode" = 3, "stateCode" = 1, "updatedAt" = now()
      FROM "User" u
      WHERE p."ownerId" = u."id"
        AND p."isTemplate" = false
        AND p."statusCode" IN (1, 2)
        AND p."endDate" IS NOT NULL
        AND p."endDate" < (now() AT TIME ZONE COALESCE(u."timezone", ${FALLBACK_COMPLETE_TZ}))::date
      RETURNING p."id"`
    const completed = completedRows.length
    await completePlanBudgets(tx, completedRows.map((r) => r.id))
    await freezeInheritedValues(tx, completedRows.map((r) => r.id))

    const activatedRows = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "Plan" p
      SET "statusCode" = 1, "updatedAt" = now()
      FROM "User" u
      WHERE p."ownerId" = u."id"
        AND p."isTemplate" = false
        AND p."statusCode" = 2
        AND p."startDate" IS NOT NULL
        AND p."endDate" IS NOT NULL
        AND p."startDate" <= (now() AT TIME ZONE COALESCE(u."timezone", ${FALLBACK_ACTIVATE_TZ}))::date
        AND p."endDate" >= (now() AT TIME ZONE COALESCE(u."timezone", ${FALLBACK_ACTIVATE_TZ}))::date
      RETURNING p."id"`
    const activated = activatedRows.length
    if (activated > 0) {
      const planIds = activatedRows.map((r) => r.id)
      const budgets = { planId: { in: planIds }, statusCode: 2 }
      await tx.transaction.updateMany({
        where: { statusCode: 2, OR: [{ planId: { in: planIds } }, { budget: budgets }] },
        data: { statusCode: 1 },
      })
      await tx.budget.updateMany({ where: budgets, data: { statusCode: 1 } })
    }

    return { completed, activated }
  })
}

async function runOnce() {
  try {
    const result = await syncPlanStatuses()
    if (result && (result.completed || result.activated)) {
      console.log(`[plan-status] completed=${result.completed} activated=${result.activated}`)
    }
  } catch (err) {
    console.error('[plan-status] sync failed', err)
  }
}

/** Runs at startup (catch-up after downtime) and then periodically. */
export function startPlanStatusScheduler() {
  void backfillCompletedPlans().then(runOnce)
  setInterval(() => void runOnce(), SYNC_INTERVAL_MS).unref()
}

// Covers plans completed before freezing existed or created as completed (e.g. imports)
async function backfillCompletedPlans() {
  try {
    const rows = await db.plan.findMany({ where: { statusCode: 3, isTemplate: false }, select: { id: true } })
    await db.$transaction(async (tx) => {
      await tx.plan.updateMany({ where: { statusCode: 3, isTemplate: false, stateCode: 0 }, data: { stateCode: 1 } })
      await completePlanBudgets(tx, rows.map((r) => r.id))
      await freezeInheritedValues(tx, rows.map((r) => r.id))
    })
  } catch (err) {
    console.error('[plan-status] backfill failed', err)
  }
}
