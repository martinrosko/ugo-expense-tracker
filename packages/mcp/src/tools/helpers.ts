import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { ApiError, type ApiClient } from '../apiClient.js'

// How a tool affects data; drives the MCP annotations clients use to decide on confirmation prompts
type Kind = 'read' | 'create' | 'update' | 'destructive'

const ANNOTATIONS = {
  read: { readOnlyHint: true, openWorldHint: false },
  create: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  update: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  destructive: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
} as const

export class ToolError extends Error {}

export interface ToolDef<S extends z.ZodRawShape> {
  name: string
  title: string
  description: string
  kind: Kind
  input: S
  run: (args: z.infer<z.ZodObject<S>>, api: ApiClient) => Promise<unknown>
}

export function defineTool<S extends z.ZodRawShape>(server: McpServer, api: ApiClient, def: ToolDef<S>): void {
  const handler = async (args: z.infer<z.ZodObject<S>>): Promise<CallToolResult> => {
    try {
      return ok(await def.run(args, api))
    } catch (err) {
      return fail(err)
    }
  }
  // The SDK's registerTool generics blow up the compiler for dynamic shapes, so call it through a loose signature
  const register = server.registerTool.bind(server) as unknown as (name: string, config: object, cb: unknown) => void
  register(
    def.name,
    { title: def.title, description: def.description, inputSchema: def.input, annotations: { title: def.title, ...ANNOTATIONS[def.kind] } },
    handler,
  )
}

export function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: data === undefined ? 'Done.' : JSON.stringify(compact(data)) }] }
}

export function fail(err: unknown): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: errorText(err) }] }
}

export function errorText(err: unknown): string {
  if (err instanceof ToolError) return err.message
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Authentication failed: the access token was rejected by the backend. Reconnect to log in again.'
    if (err.status >= 500) return `The backend failed to handle the request (HTTP ${err.status}).`
    return `${err.message} (HTTP ${err.status})`
  }
  if (err instanceof Error && err.name === 'TimeoutError') return 'The backend did not respond in time.'
  console.error(err)
  return 'Unexpected error while calling the backend.'
}

const NOISE_KEYS = new Set(['createdAt', 'updatedAt'])

// Drops nulls and bookkeeping timestamps; the LLM pays for every token of backend output
export function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compact)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, v]) => v !== null && v !== undefined && !NOISE_KEYS.has(key))
        .map(([key, v]) => [key, compact(v)]),
    )
  }
  return value
}

// Caps list output so one unfiltered call cannot flood the model's context
export function limited<T>(items: T[], limit: number) {
  return { total: items.length, returned: Math.min(items.length, limit), items: items.slice(0, limit) }
}

// Shared input fragments
export const idSchema = z.string().min(1).describe('Record id')
export const limitSchema = z.number().int().min(1).max(500).default(100).describe('Maximum number of items to return')
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
export const moneySchema = z.number().finite()
export const isoDateTimeSchema = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Use an ISO 8601 date or date-time')

const WEEK_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const

export const dueDateSchema = z
  .object({
    date: dateSchema.optional().describe('Fixed due date; takes precedence over the other fields'),
    day: z.number().int().min(1).max(31).optional().describe('Day of the month, counted from the start of the month (or from its end when backwards)'),
    weekDay: z.enum(WEEK_DAYS).optional().describe('Weekday; used when day is not set'),
    week: z.number().int().min(1).max(5).optional().describe('With weekDay: the nth occurrence in the month (default 1)'),
    month: z.number().int().min(0).max(12).optional().describe('Months after the plan start month (default 0)'),
    backwards: z.boolean().optional().describe('Count day or weekday occurrences from the end of the month'),
  })
  .describe('When a planned transaction is due, relative to the plan start; the app derives plannedOn from it')

export type DueDate = z.infer<typeof dueDateSchema>

// Converts the friendly shape to the backend's JSON string (weekDay is a power-of-two bitmask, Monday = 1)
export function toDueDateConfig(due: DueDate): string {
  const { weekDay, ...rest } = due
  return JSON.stringify({ ...rest, ...(weekDay ? { weekDay: 2 ** WEEK_DAYS.indexOf(weekDay) } : {}) })
}
