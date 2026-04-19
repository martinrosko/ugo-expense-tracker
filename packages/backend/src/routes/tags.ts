import { Router } from 'express'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

export const tagsRouter = Router()

// GET /api/tags
tagsRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const tags = await db.tag.findMany({
    where: { ownerId: req.user!.sub },
    orderBy: { name: 'asc' },
  })
  res.json(tags)
})

// POST /api/tags
tagsRouter.post('/', async (req: AuthenticatedRequest, res) => {
  const { name, color } = req.body
  const tag = await db.tag.create({
    data: { name, color, ownerId: req.user!.sub },
  })
  res.status(201).json(tag)
})

// PATCH /api/tags/:id
tagsRouter.patch('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const existing = await db.tag.findFirst({
    where: { id, ownerId: req.user!.sub },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  const { name, color } = req.body
  const tag = await db.tag.update({
    where: { id },
    data: { name, color },
  })
  res.json(tag)
})

// DELETE /api/tags/:id
tagsRouter.delete('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const existing = await db.tag.findFirst({
    where: { id, ownerId: req.user!.sub },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  await db.tag.delete({ where: { id } })
  res.status(204).end()
})
