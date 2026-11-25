import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { seg, type ApiClient } from '../apiClient.js'
import { defineTool, idSchema, limited, limitSchema, moneySchema } from './helpers.js'

const accountType = z.enum(['CASH', 'BANK', 'INVESTMENT', 'PAYMENT_PARTNER'])

export function registerUserTools(server: McpServer, api: ApiClient) {
  defineTool(server, api, {
    name: 'get_current_user',
    title: 'Get current user',
    description: 'Return the logged-in user (id, email, name, IANA timezone). The timezone defines what "today" means for plan status changes.',
    kind: 'read',
    input: {},
    run: (_args, api) => api.get('/api/users/me'),
  })

  defineTool(server, api, {
    name: 'update_current_user',
    title: 'Update current user',
    description: 'Change the user\'s display name and/or IANA timezone (e.g. "Europe/Bratislava").',
    kind: 'update',
    input: { name: z.string().min(1).optional(), timezone: z.string().min(1).optional() },
    run: (args, api) => api.patch('/api/users/me', args),
  })
}

export function registerAccountTools(server: McpServer, api: ApiClient) {
  defineTool(server, api, {
    name: 'list_accounts',
    title: 'List accounts',
    description:
      'List accounts sorted by name. Types: CASH, BANK, INVESTMENT (own money) and PAYMENT_PARTNER (a counterparty such as a shop or employer). ' +
      'A transaction moves money from one account (fromAccountId) to another (toAccountId).',
    kind: 'read',
    input: { type: accountType.optional(), withTags: z.boolean().optional(), limit: limitSchema },
    run: async ({ type, withTags, limit }, api) =>
      limited(await api.get<unknown[]>('/api/accounts', { type, withTags }), limit),
  })

  defineTool(server, api, {
    name: 'get_account',
    title: 'Get account',
    description: 'Get one account by id.',
    kind: 'read',
    input: { id: idSchema },
    run: ({ id }, api) => api.get(`/api/accounts/${seg(id)}`),
  })

  defineTool(server, api, {
    name: 'create_account',
    title: 'Create account',
    description: 'Create an account. initialBalance is the balance before any recorded transaction. isDefault marks the account preselected in the UI.',
    kind: 'create',
    input: {
      name: z.string().min(1),
      type: accountType,
      initialBalance: moneySchema.optional(),
      isDefault: z.boolean().optional(),
    },
    run: (args, api) => api.post('/api/accounts', args),
  })

  defineTool(server, api, {
    name: 'update_account',
    title: 'Update account',
    description: 'Update an account. Only the given fields change.',
    kind: 'update',
    input: {
      id: idSchema,
      name: z.string().min(1).optional(),
      type: accountType.optional(),
      initialBalance: moneySchema.optional(),
      isDefault: z.boolean().optional(),
    },
    run: ({ id, ...body }, api) => api.patch(`/api/accounts/${seg(id)}`, body),
  })

  defineTool(server, api, {
    name: 'delete_account',
    title: 'Delete account',
    description: 'Permanently delete an account. Fails when transactions, plans or bank tickets still reference it.',
    kind: 'destructive',
    input: { id: idSchema },
    run: ({ id }, api) => api.delete(`/api/accounts/${seg(id)}`),
  })
}
