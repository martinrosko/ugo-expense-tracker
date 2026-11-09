import { Router } from 'express'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

export const usersRouter = Router()

// Postgres is the authority, since the plan status job evaluates the name there
async function isValidTimezone(tz: unknown): Promise<boolean> {
  if (typeof tz !== 'string' || !tz) return false
  const [{ ok }] = await db.$queryRaw<{ ok: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = ${tz}) AS ok`
  return ok
}

// GET /api/users/me?tz=Area/City  — return or auto-provision the current user.
// tz only initializes a missing timezone; it never overwrites a stored one.
usersRouter.get('/me', async (req: AuthenticatedRequest, res) => {
  const { sub, email, name } = req.user!
  const tz = (await isValidTimezone(req.query.tz)) ? String(req.query.tz) : null
  let user = await db.user.findUnique({ where: { id: sub } })
  if (!user) {
    user = await db.user.create({
      data: { id: sub, email: email ?? '', name: name ?? '', timezone: tz },
    })
  } else if (!user.timezone && tz) {
    user = await db.user.update({ where: { id: sub }, data: { timezone: tz } })
  }
  res.json(user)
})

// PATCH /api/users/me
usersRouter.patch('/me', async (req: AuthenticatedRequest, res) => {
  const { name, timezone } = req.body
  if (timezone !== undefined && !(await isValidTimezone(timezone))) {
    res.status(400).json({ error: 'Invalid timezone' })
    return
  }
  const user = await db.user.update({
    where: { id: req.user!.sub },
    data: { name, timezone },
  })
  res.json(user)
})
