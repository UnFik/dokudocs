import { z } from 'zod'
import { apiFetch } from '@/lib/api-client'

export const PAGE = 50

const nullableId = z.string().nullable()

const summarySchema = z.object({
  runId: z.string(),
  ownerId: nullableId,
  ownerName: z.string(),
  ownerEmail: z.string(),
  workspaceId: nullableId,
  conversationId: nullableId,
  startedAt: z.string(),
  steps: z.number(),
  modelCalls: z.number(),
  toolCalls: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  durationMs: z.number(),
  outcome: z.string(),
  failed: z.boolean(),
})
export type RunSummary = z.infer<typeof summarySchema>

const stepSchema = z.object({
  seq: z.number(),
  node: z.string(),
  edge: z.string(),
  status: z.string(),
  startedAt: z.string(),
  durationMs: z.number(),
  model: z.string(),
  tier: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  finishReason: z.string(),
  tool: z.string(),
  attempt: z.number(),
  reason: z.string(),
})
export type Step = z.infer<typeof stepSchema>

const graphSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      kind: z.string(),
      x: z.number(),
      y: z.number(),
    })
  ),
  edges: z.array(
    z.object({ from: z.string(), to: z.string(), label: z.string() })
  ),
})
export type Graph = z.infer<typeof graphSchema>

const runSchema = summarySchema.extend({
  stepList: z.array(stepSchema),
  graph: graphSchema,
})
export type Run = z.infer<typeof runSchema>

const controlsSchema = z.object({
  gateEnabled: z.boolean(),
  routerEnabled: z.boolean(),
  traceRetentionDays: z.number(),
  updatedAt: z.string().optional(),
})
export type Controls = z.infer<typeof controlsSchema>

export type Filters = {
  outcome: string
  node: string
  failedOnly: boolean
  minDurationMs: string
  offset: number
}

export const NO_FILTERS: Filters = {
  outcome: '',
  node: '',
  failedOnly: false,
  minDurationMs: '',
  offset: 0,
}

/** The places a request can end, and the ones it can pass through, as the server names them. */
export const OUTCOMES = ['respond', 'reject', 'clarify', 'approval']
export const NODES = [
  'gate',
  'reject',
  'clarify',
  'route',
  'model_small',
  'model_large',
  'tools',
  'approval',
  'respond',
]

export async function listRuns(filters: Filters, signal?: AbortSignal) {
  const query = new URLSearchParams()
  if (filters.outcome) query.set('outcome', filters.outcome)
  if (filters.node) query.set('node', filters.node)
  if (filters.failedOnly) query.set('failed', 'true')
  if (filters.minDurationMs) query.set('minDurationMs', filters.minDurationMs)
  query.set('limit', String(PAGE))
  query.set('offset', String(filters.offset))
  return z
    .object({ runs: z.array(summarySchema), total: z.number() })
    .parse(await apiFetch(`/api/v1/platform/ai/runs?${query}`, { signal }))
}

export async function getRun(id: string, signal?: AbortSignal) {
  return runSchema.parse(
    await apiFetch(`/api/v1/platform/ai/runs/${id}`, { signal })
  )
}

export async function getControls(signal?: AbortSignal) {
  return controlsSchema.parse(
    await apiFetch('/api/v1/platform/ai/harness', { signal })
  )
}

export async function saveControls(controls: Controls) {
  return controlsSchema.parse(
    await apiFetch('/api/v1/platform/ai/harness', {
      method: 'PUT',
      body: JSON.stringify(controls),
    })
  )
}
