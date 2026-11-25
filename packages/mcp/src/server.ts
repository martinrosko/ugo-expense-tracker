import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ApiClient } from './apiClient.js'
import { registerAccountTools, registerUserTools } from './tools/accounts.js'
import { registerBankTicketTools } from './tools/bankTickets.js'
import { registerBudgetTools } from './tools/budgets.js'
import { registerPlanTools } from './tools/plans.js'
import { registerTagTools } from './tools/tags.js'
import { registerTransactionTools } from './tools/transactions.js'

const INSTRUCTIONS =
  'Tools for the Ugo personal finance app: accounts, tags, plans (optionally recurring), budgets and transactions. ' +
  'Tools take record ids; look them up with the list tools first. Amounts are positive decimal numbers and direction comes from the accounts. ' +
  'Tools marked destructive delete data or end a plan irreversibly; confirm with the user before using them.'

// One server per request keeps the caller's token out of shared state
export function createServer(api: ApiClient): McpServer {
  const server = new McpServer({ name: 'ugo', version: '0.1.0' }, { instructions: INSTRUCTIONS })
  registerUserTools(server, api)
  registerAccountTools(server, api)
  registerTagTools(server, api)
  registerPlanTools(server, api)
  registerBudgetTools(server, api)
  registerTransactionTools(server, api)
  registerBankTicketTools(server, api)
  return server
}
