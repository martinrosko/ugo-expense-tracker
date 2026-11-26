import { Router } from 'express'
import { AccountType } from '@prisma/client'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { sortByName } from '../services/sortNames.js'
import { accountAccessWhere, ASSET_TYPES } from '../services/access.js'

export const accountsRouter = Router()

// GET /api/accounts?type=PAYMENT_PARTNER&withTags=true  (own and co-owned accounts)
accountsRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const { type, withTags } = req.query
  const userId = req.user!.sub
  const accountType = Object.values(AccountType).find((t) => t === type)
  const accounts = await db.account.findMany({
    where: { ...accountAccessWhere(userId), ...(accountType ? { type: accountType } : {}) },
    ...(withTags === 'true' ? { include: { tags: { where: { tag: { ownerId: userId } }, include: { tag: true } } } } : {}),
  })
  res.json(sortByName(accounts.map((a) => ({ ...a, isOwner: a.ownerId === userId }))))
})

// GET /api/accounts/:id
accountsRouter.get('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const account = await db.account.findFirst({
    where: { id, ...accountAccessWhere(req.user!.sub) },
  })
  if (!account) { res.status(404).json({ error: 'Not found' }); return }
  res.json({ ...account, isOwner: account.ownerId === req.user!.sub })
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
  if (type === AccountType.PAYMENT_PARTNER && (await db.accountCoOwner.count({ where: { accountId: id } })) > 0) {
    res.status(409).json({ error: 'Remove the co-owners before making this a payment partner' }); return
  }
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

// ─── Co-owners ────────────────────────────────────────────────────────────────

// GET /api/accounts/:id/co-owners  (owner only)
accountsRouter.get('/:id/co-owners', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  if (!(await db.account.findFirst({ where: { id, ownerId: req.user!.sub }, select: { id: true } }))) { res.status(404).json({ error: 'Not found' }); return }
  const rows = await db.accountCoOwner.findMany({ where: { accountId: id }, include: { user: { select: { email: true, name: true } } }, orderBy: { createdAt: 'asc' } })
  res.json(rows.map((r) => ({ userId: r.userId, email: r.user.email, name: r.user.name })))
})

// POST /api/accounts/:id/co-owners  body: { email }  (owner only; not for payment partners)
accountsRouter.post('/:id/co-owners', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const account = await db.account.findFirst({ where: { id, ownerId: req.user!.sub }, select: { id: true, type: true } })
  if (!account) { res.status(404).json({ error: 'Not found' }); return }
  if (!ASSET_TYPES.includes(account.type)) { res.status(400).json({ error: 'Payment partners cannot be shared' }); return }
  const email = req.body?.email
  const user = typeof email === 'string' && email.trim()
    ? await db.user.findFirst({ where: { email: { equals: email.trim(), mode: 'insensitive' } } })
    : null
  if (!user) { res.status(404).json({ error: 'No user with this email. They must sign in once first.' }); return }
  if (user.id === req.user!.sub) { res.status(409).json({ error: 'You already own this account' }); return }
  await db.accountCoOwner.upsert({
    where: { accountId_userId: { accountId: id, userId: user.id } },
    create: { accountId: id, userId: user.id },
    update: {},
  })
  res.status(201).json({ userId: user.id, email: user.email, name: user.name })
})

// DELETE /api/accounts/:id/co-owners/:userId  (the owner removes anyone; a co-owner can only leave)
accountsRouter.delete('/:id/co-owners/:userId', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const userId = String(req.params.userId)
  const caller = req.user!.sub
  const account = await db.account.findFirst({ where: { id, ...accountAccessWhere(caller) }, select: { ownerId: true } })
  if (!account || (account.ownerId !== caller && userId !== caller)) { res.status(404).json({ error: 'Not found' }); return }
  await db.accountCoOwner.deleteMany({ where: { accountId: id, userId } })
  res.status(204).end()
})
