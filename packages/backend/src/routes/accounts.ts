import { Router } from 'express'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

export const accountsRouter = Router()

// GET /api/accounts
accountsRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const accounts = await db.account.findMany({
    where: { ownerId: req.user!.sub },
    orderBy: { name: 'asc' },
  })
  res.json(accounts)
})

// GET /api/accounts/:id
accountsRouter.get('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const account = await db.account.findFirst({
    where: { id, ownerId: req.user!.sub },
  })
  if (!account) { res.status(404).json({ error: 'Not found' }); return }
  res.json(account)
})

// POST /api/accounts
accountsRouter.post('/', async (req: AuthenticatedRequest, res) => {
  const { id, name, type, initialBalance, isDefault } = req.body
  const account = await db.account.create({
    data: { ...(id ? { id } : {}), name, type, initialBalance, isDefault, ownerId: req.user!.sub },
  })
  res.status(201).json(account)
})

// PATCH /api/accounts/:id
accountsRouter.patch('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const existing = await db.account.findFirst({
    where: { id, ownerId: req.user!.sub },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  const { name, type, initialBalance, isDefault } = req.body
  const account = await db.account.update({
    where: { id },
    data: { name, type, initialBalance, isDefault },
  })
  res.json(account)
})

// DELETE /api/accounts/:id
accountsRouter.delete('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const existing = await db.account.findFirst({
    where: { id, ownerId: req.user!.sub },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  await db.account.delete({ where: { id } })
  res.status(204).end()
})
