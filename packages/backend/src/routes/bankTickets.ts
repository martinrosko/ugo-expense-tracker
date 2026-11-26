import { Router } from 'express'
import db from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { accountAccessWhere, txReadWhere } from '../services/access.js'

export const bankTicketsRouter = Router()

type ImportRow = {
  ticketId?: string; name?: string; amount: number; executedOn: string; partnerName?: string; partnerAccountNumber?: string
  reference?: string; variableSymbol?: string; constantSymbol?: string; specificSymbol?: string
}

// GET /api/bank-tickets?accountId=xxx&from=YYYY-MM-DD&to=YYYY-MM-DD&unlinked=true
bankTicketsRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const { accountId, from, to, unlinked } = req.query
  const tickets = await db.bankTicket.findMany({
    where: {
      account: accountAccessWhere(req.user!.sub),
      ...(accountId ? { accountId: String(accountId) } : {}),
      ...(from || to ? { executedOn: { ...(from ? { gte: new Date(String(from).slice(0, 10)) } : {}), ...(to ? { lte: new Date(`${String(to).slice(0, 10)}T23:59:59.999Z`) } : {}) } } : {}),
      // Not booked to a transaction, not paired with a movement and not marked as processed
      ...(unlinked === 'true' ? { transaction: { is: null }, pairedTransactionId: null, stateCode: 0 } : {}),
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

// POST /api/bank-tickets/import  body: { accountId, rows: [{ ticketId?, amount, executedOn, partnerName?, ... }] }
// Stores the rows of a bank file. A ticket that is already stored (same document number, date and amount) is not duplicated;
// when it was stored for another account it moves to this one, together with the account side of its transaction.
bankTicketsRouter.post('/import', async (req: AuthenticatedRequest, res) => {
  const ownerId = req.user!.sub
  const { accountId, rows } = (req.body ?? {}) as { accountId?: string; rows?: ImportRow[] }
  if (!accountId || !Array.isArray(rows)) { res.status(400).json({ error: 'accountId and rows are required' }); return }
  const account = await db.account.findFirst({ where: { id: accountId, ...accountAccessWhere(ownerId) }, select: { id: true } })
  if (!account) { res.status(403).json({ error: 'Forbidden' }); return }

  const day = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)
  const money = (v: unknown) => Number(v).toFixed(2)
  const keyOf = (t: { ticketId?: string | null; executedOn: Date | string; amount: unknown; accountId?: string; partnerName?: string | null; reference?: string | null }) =>
    t.ticketId
      ? `${t.ticketId}|${day(t.executedOn)}|${money(t.amount)}`
      // Without a document number only the same account can be recognized again
      : `${t.accountId}||${day(t.executedOn)}|${money(t.amount)}|${t.partnerName ?? ''}|${t.reference ?? ''}`

  const ticketIds = [...new Set(rows.map((r) => r.ticketId).filter((id): id is string => !!id))]
  const include = {
    transaction: { select: { id: true, fromAccountId: true, toAccountId: true, template: { select: { fromAccountId: true, toAccountId: true } } } },
    pairedTransaction: { select: { id: true, fromAccountId: true, toAccountId: true, template: { select: { fromAccountId: true, toAccountId: true } } } },
  }
  const stored = await db.bankTicket.findMany({
    where: { account: accountAccessWhere(ownerId), OR: [{ ticketId: { in: ticketIds } }, { accountId, ticketId: null }] },
    include,
  })
  const known = new Map(stored.map((t) => [keyOf(t), t]))

  const result = { created: 0, existing: 0, moved: 0, conflicts: [] as string[] }
  for (const r of rows) {
    const key = keyOf({ ...r, accountId })
    const found = known.get(key)
    try {
      if (!found) {
        const created = await db.bankTicket.create({
          data: {
            name: r.name, amount: r.amount, executedOn: new Date(r.executedOn), partnerName: r.partnerName, partnerAccountNumber: r.partnerAccountNumber,
            reference: r.reference, variableSymbol: r.variableSymbol, constantSymbol: r.constantSymbol, specificSymbol: r.specificSymbol,
            ticketId: r.ticketId || null, accountId,
          },
          include,
        })
        known.set(key, created)
        result.created++
      } else if (found.accountId !== accountId) {
        const oldAccountId = found.accountId
        await db.$transaction(async (tx) => {
          await tx.bankTicket.update({ where: { id: found.id }, data: { accountId } })
          for (const linked of [found.transaction, found.pairedTransaction]) {
            if (!linked) continue
            // Own values win over the template's; only a side that holds the old account is replaced
            const data: { fromAccountId?: string; toAccountId?: string } = {}
            if ((linked.fromAccountId ?? linked.template?.fromAccountId) === oldAccountId) data.fromAccountId = accountId
            if ((linked.toAccountId ?? linked.template?.toAccountId) === oldAccountId) data.toAccountId = accountId
            if (Object.keys(data).length > 0) await tx.transaction.update({ where: { id: linked.id }, data })
          }
        })
        found.accountId = accountId
        result.moved++
      } else {
        result.existing++
      }
    } catch {
      result.conflicts.push(r.ticketId || `${r.executedOn} ${r.amount}`)
    }
  }
  res.json(result)
})

// GET /api/bank-tickets/:id
bankTicketsRouter.get('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const ticket = await db.bankTicket.findFirst({
    where: { id, account: accountAccessWhere(req.user!.sub) },
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
    where: { id: { in: accountIds }, ...accountAccessWhere(req.user!.sub) },
    select: { id: true },
  })
  if (ownedAccounts.length !== accountIds.length) {
    res.status(403).json({ error: 'Forbidden' }); return
  }

  const pairedIds = [...new Set(rows.map((r: { pairedTransactionId?: string }) => r.pairedTransactionId).filter(Boolean) as string[])]
  if (pairedIds.length > 0) {
    const ownedTx = await db.transaction.count({
      where: { id: { in: pairedIds }, ...txReadWhere(req.user!.sub) },
    })
    if (ownedTx !== pairedIds.length) { res.status(403).json({ error: 'Forbidden' }); return }
  }

  // A row with an id refers to an already stored ticket (e.g. one picked from the review list); others are upserted
  const storedIds = [...new Set(rows.map((r: { id?: string }) => r.id).filter(Boolean) as string[])]
  if (storedIds.length > 0) {
    const ownedTickets = await db.bankTicket.count({ where: { id: { in: storedIds }, account: accountAccessWhere(req.user!.sub) } })
    if (ownedTickets !== storedIds.length) { res.status(403).json({ error: 'Forbidden' }); return }
  }

  // Upsert on (accountId, ticketId, executedOn) to deduplicate re-imports
  const created = await Promise.all(
    rows.map((r: {
      id?: string; accountId: string; ticketId?: string; name?: string; amount: number;
      executedOn: string; partnerName?: string; partnerAccountNumber?: string;
      reference?: string; variableSymbol?: string; constantSymbol?: string; specificSymbol?: string;
      pairedTransactionId?: string; processed?: boolean;
    }) =>
      r.id ? db.bankTicket.update({
        where: { id: r.id },
        data: {
          ...(r.pairedTransactionId ? { pairedTransactionId: r.pairedTransactionId } : {}),
          ...(r.processed ? { stateCode: 1 } : {}),
        },
      }) : db.bankTicket.upsert({
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
    where: { id, account: accountAccessWhere(req.user!.sub) },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  const ticket = await db.bankTicket.update({ where: { id }, data: { pairedTransactionId: null, stateCode: 0 } })
  res.json(ticket)
})

// POST /api/bank-tickets/:id/check-counterpart
// Looks in the user's other accounts for the opposite ticket of a movement (opposite amount, within 5 days). Changes nothing:
// the caller decides what to do with the counterpart and applies it when the user submits.
bankTicketsRouter.post('/:id/check-counterpart', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const ownerId = req.user!.sub
  const txInfo = { select: { id: true, fromAccount: { select: { type: true } }, toAccount: { select: { type: true } } } }
  const ticket = await db.bankTicket.findFirst({
    where: { id, account: accountAccessWhere(ownerId) },
    include: { transaction: txInfo, pairedTransaction: txInfo },
  })
  if (!ticket) { res.status(404).json({ error: 'Not found' }); return }

  const DAY = 86_400_000
  const found = await db.bankTicket.findMany({
    where: {
      id: { not: id },
      account: accountAccessWhere(ownerId),
      accountId: { not: ticket.accountId },
      amount: ticket.amount.neg(),
      executedOn: { gte: new Date(ticket.executedOn.getTime() - 5 * DAY), lte: new Date(ticket.executedOn.getTime() + 5 * DAY) },
    },
    include: { account: { select: { name: true } }, transaction: txInfo, pairedTransaction: txInfo },
  })
  const distance = (t: { executedOn: Date }) => Math.abs(t.executedOn.getTime() - ticket.executedOn.getTime())
  const counterpart = found.sort((a, b) => distance(a) - distance(b))[0]
  if (!counterpart) { res.json({ status: 'none' }); return }

  const ASSETS = ['CASH', 'BANK', 'INVESTMENT']
  const isDone = (t: { stateCode: number; transaction: unknown; pairedTransaction: unknown }) => !!t.transaction || !!t.pairedTransaction || t.stateCode === 1
  // Only a movement between own accounts can be paired with; for anything else the ticket is just marked processed
  const movementOf = (t: { transaction: typeof ticket.transaction; pairedTransaction: typeof ticket.pairedTransaction }) => {
    const tx = t.transaction ?? t.pairedTransaction
    return tx && ASSETS.includes(tx.fromAccount?.type ?? '') && ASSETS.includes(tx.toAccount?.type ?? '') ? tx.id : null
  }
  const info = { id: counterpart.id, accountId: counterpart.accountId, account: counterpart.account.name, executedOn: counterpart.executedOn.toISOString().slice(0, 10) }

  const ticketDone = isDone(ticket)
  const counterpartDone = isDone(counterpart)
  if (ticketDone && counterpartDone) { res.json({ status: 'alreadyProcessed', counterpart: info }); return }
  if (counterpartDone) { res.json({ status: 'counterpartLinked', counterpart: info, pairTransactionId: movementOf(counterpart) }); return }
  res.json({ status: 'counterpartOpen', counterpart: info })
})

// DELETE /api/bank-tickets/:id
bankTicketsRouter.delete('/:id', async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id)
  const existing = await db.bankTicket.findFirst({
    where: { id, account: accountAccessWhere(req.user!.sub) },
  })
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }
  await db.bankTicket.delete({ where: { id } })
  res.status(204).end()
})
