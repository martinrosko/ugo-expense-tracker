import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from './apiClient.js'
import { createServer } from './server.js'

function json(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function connect(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock)
  const server = createServer(new ApiClient('http://backend', () => 'test-token'))
  const client = new Client({ name: 'test', version: '0' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(a), client.connect(b)])
  return client
}

const text = (res: { content?: unknown }) => (res.content as { text: string }[])[0].text

afterEach(() => vi.unstubAllGlobals())

describe('tool catalog', () => {
  it('annotates deletes as destructive and reads as read-only', async () => {
    const client = await connect(vi.fn())
    const { tools } = await client.listTools()
    const byName = new Map(tools.map((t) => [t.name, t]))

    for (const name of ['delete_account', 'delete_tag', 'delete_plan', 'delete_budget', 'delete_transaction', 'complete_plan']) {
      expect(byName.get(name)?.annotations?.destructiveHint, name).toBe(true)
    }
    for (const name of ['list_plans', 'get_transaction', 'list_bank_tickets']) {
      expect(byName.get(name)?.annotations?.readOnlyHint, name).toBe(true)
    }
    expect(byName.get('create_tag')?.annotations?.destructiveHint).toBe(false)
    expect(tools.some((t) => t.name.includes('import_bank'))).toBe(false)
  })
})

describe('tool calls', () => {
  it('forwards the token and query, trims the output', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, [{ id: 'a1', name: 'Cash', note: null, createdAt: 'x' }]))
    const client = await connect(fetchMock)

    const res = await client.callTool({ name: 'list_accounts', arguments: { type: 'CASH' } })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://backend/api/accounts?type=CASH')
    expect(init.headers.Authorization).toBe('Bearer test-token')
    expect(JSON.parse(text(res))).toEqual({ total: 1, returned: 1, items: [{ id: 'a1', name: 'Cash' }] })
  })

  it('turns backend errors into tool errors', async () => {
    const client = await connect(vi.fn().mockResolvedValue(json(409, { error: 'Plan has executed transactions' })))

    const res = await client.callTool({ name: 'delete_plan', arguments: { id: 'p1' } })

    expect(res.isError).toBe(true)
    expect(text(res)).toBe('Plan has executed transactions (HTTP 409)')
  })

  it('refuses to log into a plan that is not active', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { id: 'p1', statusCode: 0, isTemplate: true }))
    const client = await connect(fetchMock)

    const res = await client.callTool({ name: 'log_transaction', arguments: { planId: 'p1', name: 'Coffee', amount: 3 } })

    expect(res.isError).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('logs into an active plan with the status the UI would set', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(200, { id: 'p1', statusCode: 1, isTemplate: false }))
      .mockResolvedValueOnce(json(201, { id: 't1' }))
    const client = await connect(fetchMock)

    await client.callTool({ name: 'log_transaction', arguments: { planId: 'p1', name: 'Coffee', amount: 3, executedOn: '2026-11-25' } })

    const body = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(body).toMatchObject({ planId: 'p1', budgetId: null, executedOn: '2026-11-25', statusCode: 1, stateCode: 0, type: 'TRANSACTION' })
  })

  it('converts the due date to the backend bitmask format', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(201, { id: 't1' }))
    const client = await connect(fetchMock)

    await client.callTool({
      name: 'add_planned_transaction',
      arguments: { budgetId: 'b1', name: 'Rent', plannedAmount: 500, dueDate: { weekDay: 'WED', week: 2 } },
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(JSON.parse(body.dueDateConfig)).toEqual({ week: 2, weekDay: 4 })
  })

  it('requires exactly one of planId and budgetId', async () => {
    const client = await connect(vi.fn())

    const res = await client.callTool({ name: 'add_planned_transaction', arguments: { name: 'x', plannedAmount: 1 } })

    expect(res.isError).toBe(true)
    expect(text(res)).toContain('exactly one')
  })
})
