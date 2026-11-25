import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { seg, type ApiClient } from '../apiClient.js'
import { defineTool, idSchema, limited, limitSchema, moneySchema } from './helpers.js'

const DOMAIN =
  'A budget is an envelope inside a plan with an amount; transactions can be planned or executed inside it. ' +
  'Budgets of a recurring plan instance inherit name, amount and default account from the template budget until overridden.'

export function registerBudgetTools(server: McpServer, api: ApiClient) {
  defineTool(server, api, {
    name: 'list_budgets',
    title: 'List budgets',
    description: `List budgets sorted by name, optionally of one plan. ${DOMAIN}`,
    kind: 'read',
    input: { planId: idSchema.optional(), limit: limitSchema },
    run: async ({ planId, limit }, api) => limited(await api.get<unknown[]>('/api/budgets', { planId }), limit),
  })

  defineTool(server, api, {
    name: 'get_budget',
    title: 'Get budget',
    description: `Get a budget with its transactions. ${DOMAIN}`,
    kind: 'read',
    input: { id: idSchema },
    run: ({ id }, api) => api.get(`/api/budgets/${seg(id)}`),
  })

  defineTool(server, api, {
    name: 'create_budget',
    title: 'Create budget',
    description: `Create a budget in a plan. Adding one to a template also creates it in the template's instances. ${DOMAIN}`,
    kind: 'create',
    input: {
      planId: idSchema,
      name: z.string().min(1),
      amount: moneySchema.optional().describe('Planned amount of the envelope'),
      defaultAccountId: idSchema.optional(),
    },
    run: (args, api) => api.post('/api/budgets', args),
  })

  defineTool(server, api, {
    name: 'update_budget',
    title: 'Update budget',
    description: 'Update a budget. Only the given fields change.',
    kind: 'update',
    input: { id: idSchema, name: z.string().min(1).optional(), amount: moneySchema.optional(), defaultAccountId: idSchema.optional() },
    run: ({ id, ...body }, api) => api.patch(`/api/budgets/${seg(id)}`, body),
  })

  defineTool(server, api, {
    name: 'delete_budget',
    title: 'Delete budget',
    description: 'Permanently delete a budget and its transactions. Fails when any of them was executed.',
    kind: 'destructive',
    input: { id: idSchema },
    run: ({ id }, api) => api.delete(`/api/budgets/${seg(id)}`),
  })
}
