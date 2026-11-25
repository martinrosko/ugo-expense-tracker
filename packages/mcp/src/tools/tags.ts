import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { seg, type ApiClient } from '../apiClient.js'
import { defineTool, idSchema } from './helpers.js'

export function registerTagTools(server: McpServer, api: ApiClient) {
  defineTool(server, api, {
    name: 'list_tags',
    title: 'List tags',
    description: 'List all tags sorted by name. Tags categorize transactions, plans, budgets and accounts.',
    kind: 'read',
    input: {},
    run: (_args, api) => api.get('/api/tags'),
  })

  defineTool(server, api, {
    name: 'create_tag',
    title: 'Create tag',
    description: 'Create a tag. The name must be unique, ignoring case.',
    kind: 'create',
    input: { name: z.string().min(1), color: z.string().optional().describe('CSS color, e.g. "#ff8800"') },
    run: (args, api) => api.post('/api/tags', args),
  })

  defineTool(server, api, {
    name: 'rename_tag',
    title: 'Rename tag',
    description: 'Change a tag\'s name and optionally its color. The name must stay unique, ignoring case.',
    kind: 'update',
    input: { id: idSchema, name: z.string().min(1), color: z.string().optional() },
    run: ({ id, ...body }, api) => api.patch(`/api/tags/${seg(id)}`, body),
  })

  defineTool(server, api, {
    name: 'delete_tag',
    title: 'Delete tag',
    description: 'Permanently delete a tag and remove it from everything it is assigned to.',
    kind: 'destructive',
    input: { id: idSchema },
    run: ({ id }, api) => api.delete(`/api/tags/${seg(id)}`),
  })

  defineTool(server, api, {
    name: 'set_object_tags',
    title: 'Set tags of an object',
    description: 'Replace the tags of a transaction, plan, budget or account with exactly the given tags. Pass an empty list to clear them. Returns the resulting tags.',
    kind: 'update',
    input: {
      type: z.enum(['transaction', 'plan', 'budget', 'account']),
      id: idSchema.describe('Id of the object'),
      tagIds: z.array(z.string().min(1)),
    },
    run: ({ type, id, tagIds }, api) => api.put(`/api/tags/objects/${type}/${seg(id)}`, { tagIds }),
  })
}
