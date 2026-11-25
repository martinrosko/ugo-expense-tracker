import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { seg, type ApiClient } from '../apiClient.js'
import {
  defineTool, dateSchema, dueDateSchema, idSchema, isoDateTimeSchema, limited, limitSchema, moneySchema, ToolError, toDueDateConfig,
} from './helpers.js'

const DOMAIN =
  'A transaction moves a positive amount from fromAccountId to toAccountId (an income has a PAYMENT_PARTNER as source, an expense one as target). ' +
  'A planned transaction has plannedAmount and a due date and no executedOn; executing it records amount and executedOn. ' +
  'A transaction lives in a budget (budgetId) or directly in a plan (planId). Planned transactions of a recurring plan instance inherit from the template.'

const where = {
  planId: idSchema.optional().describe('Put the transaction directly in this plan (without a budget)'),
  budgetId: idSchema.optional().describe('Put the transaction in this budget'),
}

function exactlyOne(planId?: string, budgetId?: string) {
  if (!!planId === !!budgetId) throw new ToolError('Provide exactly one of planId or budgetId.')
}

// Status of the plan a transaction would land in; the UI stamps new executed transactions with it
async function targetPlan(api: ApiClient, planId?: string, budgetId?: string) {
  let id = planId
  if (budgetId) id = (await api.get<{ planId: string }>(`/api/budgets/${seg(budgetId)}`)).planId
  return api.get<{ id: string; statusCode: number; isTemplate: boolean }>(`/api/plans/${seg(id!)}`)
}

export function registerTransactionTools(server: McpServer, api: ApiClient) {
  defineTool(server, api, {
    name: 'list_transactions',
    title: 'List transactions',
    description:
      `List transactions, most recently executed first. ${DOMAIN} ` +
      'Filtering by a template plan or budget also returns the transactions of its instances. from and to (together) filter by execution date.',
    kind: 'read',
    input: {
      planId: idSchema.optional(),
      budgetId: idSchema.optional(),
      accountId: idSchema.optional().describe('Account on either side of the transaction'),
      executedOnly: z.boolean().optional().describe('Only executed transactions (skip planned ones)'),
      from: dateSchema.optional(),
      to: dateSchema.optional(),
      limit: limitSchema,
    },
    run: async ({ limit, executedOnly, ...query }, api) =>
      limited(await api.get<unknown[]>('/api/transactions', { ...query, executed: executedOnly ? true : undefined }), limit),
  })

  defineTool(server, api, {
    name: 'get_transaction',
    title: 'Get transaction',
    description: `Get one transaction with its tags and bank ticket. ${DOMAIN}`,
    kind: 'read',
    input: { id: idSchema },
    run: ({ id }, api) => api.get(`/api/transactions/${seg(id)}`),
  })

  defineTool(server, api, {
    name: 'log_transaction',
    title: 'Log transaction',
    description:
      `Record a transaction that already happened (unplanned) in an active or completed plan. ${DOMAIN} ` +
      'To record a planned transaction instead, use execute_planned_transaction.',
    kind: 'create',
    input: {
      ...where,
      name: z.string().min(1),
      amount: moneySchema.positive(),
      executedOn: isoDateTimeSchema.optional().describe('ISO date or date-time; defaults to now'),
      fromAccountId: idSchema.optional(),
      toAccountId: idSchema.optional(),
      tagIds: z.array(idSchema).optional(),
    },
    run: async ({ planId, budgetId, executedOn, ...rest }, api) => {
      exactlyOne(planId, budgetId)
      const plan = await targetPlan(api, planId, budgetId)
      if (plan.isTemplate || (plan.statusCode !== 1 && plan.statusCode !== 3)) {
        throw new ToolError('Transactions can only be logged in an active or completed plan, not in a template, draft, scheduled or cancelled one.')
      }
      const completed = plan.statusCode === 3
      return api.post('/api/transactions', {
        ...rest,
        executedOn: executedOn ?? new Date().toISOString(),
        type: 'TRANSACTION',
        budgetId: budgetId ?? null,
        planId: budgetId ? null : plan.id,
        statusCode: completed ? 3 : 1,
        stateCode: completed ? 1 : 0,
      })
    },
  })

  defineTool(server, api, {
    name: 'add_planned_transaction',
    title: 'Add planned transaction',
    description:
      `Add a planned (not yet executed) transaction to a plan or budget. Adding one to a template also adds it to the template's instances. ${DOMAIN}`,
    kind: 'create',
    input: {
      ...where,
      name: z.string().min(1),
      plannedAmount: moneySchema.positive(),
      dueDate: dueDateSchema.optional(),
      fromAccountId: idSchema.optional(),
      toAccountId: idSchema.optional(),
      tagIds: z.array(idSchema).optional(),
    },
    run: ({ planId, budgetId, dueDate, ...rest }, api) => {
      exactlyOne(planId, budgetId)
      return api.post('/api/transactions', {
        ...rest,
        type: 'TRANSACTION',
        planId: planId ?? null,
        budgetId: budgetId ?? null,
        ...(dueDate ? { dueDateConfig: toDueDateConfig(dueDate) } : {}),
      })
    },
  })

  defineTool(server, api, {
    name: 'update_transaction',
    title: 'Update transaction',
    description:
      'Update a transaction. Only the given fields change; tagIds replaces all tags. ' +
      'Giving planId or budgetId moves it (not possible for planned transactions of a recurring plan). ' +
      'To record a planned transaction as done use execute_planned_transaction.',
    kind: 'update',
    input: {
      id: idSchema,
      name: z.string().min(1).optional(),
      amount: moneySchema.positive().optional().describe('Executed amount'),
      plannedAmount: moneySchema.positive().optional(),
      executedOn: isoDateTimeSchema.optional(),
      dueDate: dueDateSchema.optional(),
      fromAccountId: idSchema.optional(),
      toAccountId: idSchema.optional(),
      tagIds: z.array(idSchema).optional(),
      ...where,
    },
    run: ({ id, dueDate, planId, budgetId, ...rest }, api) => {
      if (planId && budgetId) throw new ToolError('Provide only one of planId or budgetId.')
      return api.patch(`/api/transactions/${seg(id)}`, {
        ...rest,
        ...(planId ? { planId } : {}),
        ...(budgetId ? { budgetId } : {}),
        ...(dueDate ? { dueDateConfig: toDueDateConfig(dueDate) } : {}),
      })
    },
  })

  defineTool(server, api, {
    name: 'execute_planned_transaction',
    title: 'Execute planned transaction',
    description:
      'Record a planned transaction as executed. Works for plans that are active or completed. ' +
      'amount defaults to the planned amount, executedOn to now; name, accounts and tagIds override the planned values.',
    kind: 'update',
    input: {
      id: idSchema,
      amount: moneySchema.positive().optional(),
      executedOn: isoDateTimeSchema.optional(),
      name: z.string().min(1).optional(),
      fromAccountId: idSchema.optional(),
      toAccountId: idSchema.optional(),
      tagIds: z.array(idSchema).optional(),
    },
    run: ({ id, ...body }, api) => api.post(`/api/transactions/${seg(id)}/execute`, body),
  })

  defineTool(server, api, {
    name: 'unexecute_transaction',
    title: 'Revert executed transaction to planned',
    description: 'Turn an executed transaction that came from a planned one back into planned: its amount, execution date, bank ticket link and tags are cleared. Transactions without a planned origin cannot be reverted; delete them instead.',
    kind: 'update',
    input: { id: idSchema },
    run: ({ id }, api) => api.post(`/api/transactions/${seg(id)}/unexecute`),
  })

  defineTool(server, api, {
    name: 'delete_transaction',
    title: 'Delete transaction',
    description: 'Permanently delete a transaction with its tags. Deleting a planned transaction of a template removes it from untouched instances.',
    kind: 'destructive',
    input: { id: idSchema },
    run: ({ id }, api) => api.delete(`/api/transactions/${seg(id)}`),
  })
}
