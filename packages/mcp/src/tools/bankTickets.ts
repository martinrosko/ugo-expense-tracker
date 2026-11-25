import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { seg, type ApiClient } from '../apiClient.js'
import { defineTool, dateSchema, idSchema, limited, limitSchema } from './helpers.js'
import { z } from 'zod'

const DOMAIN =
  'A bank ticket is one row of an imported bank statement. It is unlinked until it is booked to a transaction, paired with a movement between own accounts, or marked processed.'

export function registerBankTicketTools(server: McpServer, api: ApiClient) {
  defineTool(server, api, {
    name: 'list_bank_tickets',
    title: 'List bank tickets',
    description: `List imported bank tickets, newest first (read-only). ${DOMAIN} from and to filter by execution date.`,
    kind: 'read',
    input: {
      accountId: idSchema.optional(),
      from: dateSchema.optional(),
      to: dateSchema.optional(),
      unlinked: z.boolean().optional().describe('Only tickets that are not booked, paired or processed yet'),
      limit: limitSchema,
    },
    run: async ({ limit, ...query }, api) => limited(await api.get<unknown[]>('/api/bank-tickets', query), limit),
  })

  defineTool(server, api, {
    name: 'get_bank_ticket',
    title: 'Get bank ticket',
    description: `Get one bank ticket (read-only). ${DOMAIN}`,
    kind: 'read',
    input: { id: idSchema },
    run: ({ id }, api) => api.get(`/api/bank-tickets/${seg(id)}`),
  })
}
