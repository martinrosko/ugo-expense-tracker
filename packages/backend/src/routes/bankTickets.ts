import { Router } from 'express'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

export const bankTicketsRouter = Router()

// GET /api/bank-tickets?accountId=xxx
bankTicketsRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const { accountId } = req.query
  const tickets = await db.bankTicket.findMany({
    where: {
      account: { ownerId: req.user!.sub },
      ...(accountId ? { accountId: String(accountId) } : {}),
    },
    include: {
      // Lets the import suggest partner and budget from what the same counterparty was booked to before
      transaction: {
        select: {
          id: true,
          fromAccount: { select: { id: true, name: true, type: true } },
          toAccount: { select: { id: true, name: true, type: true } },
          plan: { select: { id: true, templateId: true } },
          budget: { select: { id: true, name: true, templateId: true, template: { select: { name: true } }, plan: { select: { id: true, templateId: true } } } },
        },
      },
    },
    orderBy: { executedOn: 'desc' },
  })
  res.json(tickets)
})

// GET /api/bank-tickets/:id
bankTicketsRouter.get('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const ticket = await db.bankTicket.findFirst({
    where: { id, account: { ownerId: req.user!.sub } },
    include: { transaction: true },
  })
  if (!ticket) { res.status(404).json({ error: 'Not found' }); return }
  res.json(ticket)
})

// POST /api/bank-tickets  (single or bulk import)
bankTicketsRouter.post('/', async (req: AuthenticatedRequest, res) => {
  const body = req.body
  const rows: typeof body[] = Array.isArray(body) ? body : [body]

  // Verify all referenced accounts belong to this user
  const accountIds = [...new Set(rows.map((r: { accountId: string }) => r.accountId))]
  const ownedAccounts = await db.account.findMany({
    where: { id: { in: accountIds }, ownerId: req.user!.sub },
    select: { id: true },
  })
  if (ownedAccounts.length !== accountIds.length) {
    res.status(403).json({ error: 'Forbidden' }); return
  }

  const pairedIds = [...new Set(rows.map((r: { pairedTransactionId?: string }) => r.pairedTransactionId).filter(Boolean) as string[])]
  if (pairedIds.length > 0) {
    const ownedTx = await db.transaction.count({
      where: { id: { in: pairedIds }, OR: [{ budget: { plan: { ownerId: req.user!.sub } } }, { plan: { ownerId: req.user!.sub } }] },
    })
    if (ownedTx !== pairedIds.length) { res.status(403).json({ error: 'Forbidden' }); return }
  }

  // Upsert on (accountId, ticketId, executedOn) to deduplicate re-imports
  const created = await Promise.all(
    rows.map((r: {
      accountId: string; ticketId?: string; name?: string; amount: number;
      executedOn: string; partnerName?: string; partnerAccountNumber?: string;
      reference?: string; variableSymbol?: string; constantSymbol?: string; specificSymbol?: string;
      pairedTransactionId?: string; processed?: boolean;
    }) =>
      db.bankTicket.upsert({
        where: { accountId_ticketId_executedOn: { accountId: r.accountId, ticketId: r.ticketId ?? '', executedOn: new Date(r.executedOn) } },
        create: {
          name: r.name,
          amount: r.amount,
          executedOn: new Date(r.executedOn),
          partnerName: r.partnerName,
          partnerAccountNumber: r.partnerAccountNumber,
          reference: r.reference,
          variableSymbol: r.variableSymbol,
          constantSymbol: r.constantSymbol,
          specificSymbol: r.specificSymbol,
          ticketId: r.ticketId,
          accountId: r.accountId,
          pairedTransactionId: r.pairedTransactionId,
          // stateCode 1 = processed without a transaction of its own
          stateCode: r.processed ? 1 : undefined,
        },
        update: {
          ...(r.pairedTransactionId ? { pairedTransactionId: r.pairedTransactionId } : {}),
          ...(r.processed ? { stateCode: 1 } : {}),
        },
      })
    )
  )
  res.status(201).json(created)
})

// POST /api/bank-tickets/:id/unpair  (marks a processed ticket as unprocessed again)
bankTicketsRouter.post('/:id/unpair', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const existing = await db.bankTicket.findFirst({
    where: { id, account: { ownerId: req.user!.sub } },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  const ticket = await db.bankTicket.update({ where: { id }, data: { pairedTransactionId: null, stateCode: 0 } })
  res.json(ticket)
})

// DELETE /api/bank-tickets/:id
bankTicketsRouter.delete('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const existing = await db.bankTicket.findFirst({
    where: { id, account: { ownerId: req.user!.sub } },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  await db.bankTicket.delete({ where: { id } })
  res.status(204).end()
})
