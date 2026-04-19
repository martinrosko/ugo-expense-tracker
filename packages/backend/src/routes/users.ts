import { Router } from 'express'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

export const usersRouter = Router()

// GET /api/users/me  — return or auto-provision the current user
usersRouter.get('/me', async (req: AuthenticatedRequest, res) => {
  const { sub, email, name } = req.user!
  let user = await db.user.findUnique({ where: { id: sub } })
  if (!user) {
    user = await db.user.create({
      data: { id: sub, email: email ?? '', name: name ?? '' },
    })
  }
  res.json(user)
})

// PATCH /api/users/me
usersRouter.patch('/me', async (req: AuthenticatedRequest, res) => {
  const { name } = req.body
  const user = await db.user.update({
    where: { id: req.user!.sub },
    data: { name },
  })
  res.json(user)
})
