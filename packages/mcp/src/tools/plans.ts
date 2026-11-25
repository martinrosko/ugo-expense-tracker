import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { seg, type ApiClient } from '../apiClient.js'
import { defineTool, dateSchema, idSchema, limited, limitSchema } from './helpers.js'

const DOMAIN =
  'A plan groups budgets (envelopes with an amount) and transactions. Status: 0 Draft, 1 Active, 2 Scheduled, 3 Completed, 4 Cancelled. ' +
  'A recurring plan (WEEKLY/MONTHLY/YEARLY) is a template (isTemplate=true) that spawns one instance per period; instances inherit name and ' +
  'amounts from the template until overridden, and edits to the template propagate to instances that were not overridden.'

const intervalType = z.enum(['ONE_TIME', 'WEEKLY', 'MONTHLY', 'YEARLY'])

export function registerPlanTools(server: McpServer, api: ApiClient) {
  defineTool(server, api, {
    name: 'list_plans',
    title: 'List plans',
    description:
      `List plans, newest first. ${DOMAIN} Set detailed=true to include budgets and their transactions (large output; narrow with filters). ` +
      'The date range (from and to together) returns plans overlapping it.',
    kind: 'read',
    input: {
      status: z.number().int().min(0).max(4).optional().describe('Status code filter'),
      isTemplate: z.boolean().optional(),
      templateId: idSchema.optional().describe('Only instances of this template'),
      from: dateSchema.optional(),
      to: dateSchema.optional(),
      detailed: z.boolean().optional(),
      limit: limitSchema,
    },
    run: async ({ limit, ...query }, api) => limited(await api.get<unknown[]>('/api/plans', query), limit),
  })

  defineTool(server, api, {
    name: 'get_plan',
    title: 'Get plan',
    description: `Get a plan with all its budgets and transactions (planned and executed). ${DOMAIN}`,
    kind: 'read',
    input: { id: idSchema },
    run: ({ id }, api) => api.get(`/api/plans/${seg(id)}`),
  })

  defineTool(server, api, {
    name: 'get_plan_recurrence',
    title: 'Get plan recurrence',
    description: 'Recurrence info of a recurring template or one of its instances: interval, repeat-every, first/current/last period and number of future instances.',
    kind: 'read',
    input: { id: idSchema },
    run: ({ id }, api) => api.get(`/api/plans/${seg(id)}/recurrence`),
  })

  defineTool(server, api, {
    name: 'create_plan',
    title: 'Create plan',
    description:
      'Create a plan as a Draft. Add budgets and planned transactions, then call activate_plan, which sets the dates or recurrence. ' + DOMAIN,
    kind: 'create',
    input: {
      name: z.string().min(1),
      intervalType,
      defaultAccountId: idSchema.optional().describe('Account used by default for the plan\'s transactions'),
    },
    run: (args, api) => api.post('/api/plans', { ...args, isTemplate: true, statusCode: 0 }),
  })

  defineTool(server, api, {
    name: 'update_plan',
    title: 'Update plan',
    description: 'Update a plan\'s name, dates or default account. Only the given fields change. Use complete_plan or cancel_plan to change the status.',
    kind: 'update',
    input: {
      id: idSchema,
      name: z.string().min(1).optional(),
      startDate: dateSchema.optional(),
      endDate: dateSchema.optional(),
      defaultAccountId: idSchema.optional(),
    },
    run: ({ id, ...body }, api) => api.patch(`/api/plans/${seg(id)}`, body),
  })

  defineTool(server, api, {
    name: 'activate_plan',
    title: 'Activate draft plan',
    description:
      'Activate a Draft plan; it becomes Active, Scheduled, or Completed when already over. ' +
      'ONE_TIME plans need startDate and endDate. Recurring templates need repeatEvery (every n periods), startPeriod (a date within the first period, not in the past) ' +
      'and either mode="count" with count (periods after the first) or mode="until" with until (a date within the last period). Recurring activation creates the instances.',
    kind: 'update',
    input: {
      id: idSchema,
      startDate: dateSchema.optional(),
      endDate: dateSchema.optional(),
      repeatEvery: z.number().int().min(1).max(1000).optional(),
      startPeriod: dateSchema.optional(),
      mode: z.enum(['count', 'until']).optional(),
      count: z.number().int().min(0).optional(),
      until: dateSchema.optional(),
    },
    run: ({ id, ...body }, api) => api.post(`/api/plans/${seg(id)}/activate`, body),
  })

  defineTool(server, api, {
    name: 'change_plan_recurrence',
    title: 'Change plan recurrence',
    description:
      'Change how far a recurring plan extends: mode="count" with count (periods after the current one) or mode="until" with until (date). ' +
      'Creates missing future instances and deletes future ones that are no longer needed. Accepts the template or any of its instances.',
    kind: 'update',
    input: { id: idSchema, mode: z.enum(['count', 'until']), count: z.number().int().min(0).optional(), until: dateSchema.optional() },
    run: ({ id, ...body }, api) => api.post(`/api/plans/${seg(id)}/recurrence`, body),
  })

  defineTool(server, api, {
    name: 'complete_plan',
    title: 'Complete plan',
    description: 'Mark a plan Completed. This is a one-way step: the plan and its budgets become inactive and values inherited from the template are frozen, so later template edits no longer affect it.',
    kind: 'destructive',
    input: { id: idSchema },
    run: ({ id }, api) => api.patch(`/api/plans/${seg(id)}`, { statusCode: 3 }),
  })

  defineTool(server, api, {
    name: 'cancel_plan',
    title: 'Cancel plan',
    description: 'Mark a plan Cancelled. Its data stays but it is no longer treated as active.',
    kind: 'destructive',
    input: { id: idSchema },
    run: ({ id }, api) => api.patch(`/api/plans/${seg(id)}`, { statusCode: 4 }),
  })

  defineTool(server, api, {
    name: 'delete_plan',
    title: 'Delete plan',
    description:
      'Permanently delete a plan with its budgets and transactions. Fails when any transaction was executed. ' +
      'Deleting a template detaches its instances, which keep the values they inherited.',
    kind: 'destructive',
    input: { id: idSchema },
    run: ({ id }, api) => api.delete(`/api/plans/${seg(id)}`),
  })
}
