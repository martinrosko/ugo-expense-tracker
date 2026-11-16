import { Router } from 'express'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { isTagObjectType, listObjectTags, listUnionTags, ownsObject, replaceObjectTags, type TagObjectType } from '../services/tagObjects.js'
import { sortByName } from '../services/sortNames.js'

export const tagsRouter = Router()

// Returns the trimmed name, or an error when it is empty or already used by another tag of the owner
async function validateName(raw: unknown, ownerId: string, excludeId?: string): Promise<{ name: string } | { error: string }> {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!name) return { error: 'Name must not be empty' }
  const duplicate = await db.tag.findFirst({
    where: { ownerId, name: { equals: name, mode: 'insensitive' }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  })
  if (duplicate) return { error: 'A tag with this name already exists' }
  return { name }
}

// GET /api/tags
tagsRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const tags = await db.tag.findMany({
    where: { ownerId: req.user!.sub },
  })
  res.json(sortByName(tags))
})

// POST /api/tags
tagsRouter.post('/', async (req: AuthenticatedRequest, res) => {
  const checked = await validateName(req.body?.name, req.user!.sub)
  if ('error' in checked) { res.status(409).json({ error: checked.error }); return }
  const tag = await db.tag.create({
    data: { ...(req.body?.id ? { id: String(req.body.id) } : {}), name: checked.name, color: req.body?.color, ownerId: req.user!.sub },
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
  const checked = await validateName(req.body?.name, req.user!.sub, id)
  if ('error' in checked) { res.status(409).json({ error: checked.error }); return }
  const tag = await db.tag.update({
    where: { id },
    data: { name: checked.name, color: req.body?.color },
  })
  res.json(tag)
})

// GET /api/tags/union?planId=&budgetId=&accountIds=a,b  — distinct union of the tags of the given objects
tagsRouter.get('/union', async (req: AuthenticatedRequest, res) => {
  const ids = (v: unknown) => (typeof v === 'string' ? v.split(',').filter(Boolean) : [])
  const of = (type: TagObjectType, v: unknown) => ids(v).map((id) => ({ type, id }))
  const objects = [...of('plan', req.query.planId), ...of('budget', req.query.budgetId), ...of('account', req.query.accountIds)]
  res.json(await listUnionTags(db, objects, req.user!.sub))
})

// GET /api/tags/objects/:type/:id  (type = transaction | plan | budget | account)
tagsRouter.get('/objects/:type/:id', async (req: AuthenticatedRequest, res) => {
  const type = String(req.params.type)
  const id = String(req.params.id)
  if (!isTagObjectType(type)) { res.status(400).json({ error: 'Unknown object type' }); return }
  if (!(await ownsObject(db, type, id, req.user!.sub))) { res.status(404).json({ error: 'Not found' }); return }
  res.json(await listObjectTags(db, type, id))
})

// PUT /api/tags/objects/:type/:id  body: { tagIds: string[] }  — replaces the object's tags
tagsRouter.put('/objects/:type/:id', async (req: AuthenticatedRequest, res) => {
  const type = String(req.params.type)
  const id = String(req.params.id)
  if (!isTagObjectType(type)) { res.status(400).json({ error: 'Unknown object type' }); return }
  if (!Array.isArray(req.body?.tagIds)) { res.status(400).json({ error: 'tagIds must be an array' }); return }
  if (!(await ownsObject(db, type, id, req.user!.sub))) { res.status(404).json({ error: 'Not found' }); return }
  const tags = await db.$transaction(async (client) => {
    await replaceObjectTags(client, type, id, req.user!.sub, req.body.tagIds)
    return listObjectTags(client, type, id)
  })
  res.json(tags)
})

// POST /api/tags/objects/:type/:id  body: { tagId, id?, amount? }  — adds one tag (409 if already assigned)
tagsRouter.post('/objects/:type/:id', async (req: AuthenticatedRequest, res) => {
  const type = String(req.params.type)
  const id = String(req.params.id)
  if (!isTagObjectType(type)) { res.status(400).json({ error: 'Unknown object type' }); return }
  if (!(await ownsObject(db, type, id, req.user!.sub))) { res.status(404).json({ error: 'Not found' }); return }
  const { id: linkId, tagId, amount } = req.body ?? {}
  const ownTag = await db.tag.findFirst({ where: { id: String(tagId), ownerId: req.user!.sub }, select: { id: true } })
  if (!ownTag) { res.status(404).json({ error: 'Tag not found' }); return }
  const target = { transaction: { transactionId: id }, plan: { planId: id }, budget: { budgetId: id }, account: { accountId: id } }[type]
  const duplicate = await db.tagObject.findFirst({
    where: { OR: [{ ...target, tagId: ownTag.id }, ...(linkId ? [{ id: String(linkId) }] : [])] },
    select: { id: true },
  })
  if (duplicate) { res.status(409).json({ error: 'Tag is already assigned' }); return }
  const link = await db.tagObject.create({
    data: { ...(linkId ? { id: String(linkId) } : {}), ...target, tagId: ownTag.id, amount },
    include: { tag: true },
  })
  res.status(201).json(link)
})

// DELETE /api/tags/:id
tagsRouter.delete('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const existing = await db.tag.findFirst({
    where: { id, ownerId: req.user!.sub },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  await db.$transaction([
    db.tagObject.deleteMany({ where: { tagId: id } }),
    db.tag.delete({ where: { id } }),
  ])
  res.status(204).end()
})
