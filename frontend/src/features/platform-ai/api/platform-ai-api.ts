import { z } from 'zod'
import {
  aiRunSchema,
  followAIRun,
  readEventStream,
  type AIRun,
} from '@/lib/ai-runs'
import { apiFetch, apiStream, ApiError } from '@/lib/api-client'

export const PROTOCOLS = [
  { value: 'openai_responses', label: 'Responses' },
  { value: 'openai_chat_completions', label: 'Chat Completions' },
] as const

const viewSchema = z.object({
  purpose: z.string(),
  baseURL: z.string(),
  protocol: z.string(),
  model: z.string(),
  keyHint: z.string(),
  updatedAt: z.string(),
  lastError: z.string(),
  lastErrorAt: z.string().nullable(),
})
export type SettingView = z.infer<typeof viewSchema>

const overviewSchema = z.object({
  answer: viewSchema.nullable(),
  embedding: viewSchema.nullable(),
  embeddingPending: viewSchema.nullable(),
  agent: viewSchema.nullable().optional(),
  progress: z.object({ done: z.number(), total: z.number() }).nullable(),
})
export type Overview = z.infer<typeof overviewSchema>

const changesSchema = z.object({
  changes: z.array(
    z.object({
      purpose: z.string(),
      changedAt: z.string(),
      changes: z.record(
        z.string(),
        z.object({ from: z.string(), to: z.string() })
      ),
    })
  ),
})
export type Change = z.infer<typeof changesSchema>['changes'][number]

export type Purpose = 'answer' | 'embedding' | 'agent'
export type SettingInput = {
  baseURL: string
  protocol: string
  model: string
  apiKey: string
}

const path = (purpose: Purpose) => `/api/v1/platform/ai/${purpose}`

export async function getOverviewApi(signal?: AbortSignal) {
  return overviewSchema.parse(await apiFetch('/api/v1/platform/ai', { signal }))
}
export async function getChangesApi(signal?: AbortSignal) {
  return changesSchema.parse(
    await apiFetch('/api/v1/platform/ai/changes', { signal })
  ).changes
}
export type Streaming = 'supported' | 'unsupported' | 'unverified'

const jobResultSchema = z.object({
  operation: z.enum(['test', 'save']),
  streaming: z.enum(['supported', 'unsupported', 'unverified']),
})
export type JobResult = z.infer<typeof jobResultSchema>

export async function getLatestJobApi(
  purpose: Purpose,
  signal?: AbortSignal
): Promise<AIRun | null> {
  const run = await apiFetch<unknown>(`${path(purpose)}/runs/latest`, {
    signal,
  })
  return run ? aiRunSchema.parse(run) : null
}

/** What a finished test or save run says, or null while it has none. */
export function jobResult(run: AIRun): JobResult | null {
  const parsed = jobResultSchema.safeParse(run.result)
  return parsed.success ? parsed.data : null
}

/**
 * Follows a run that is already going until it ends and returns its last state.
 * Leaving the page only stops watching; the server finishes the job.
 */
export async function awaitJob(
  run: AIRun,
  options: { signal?: AbortSignal; onPhase?: (phase: string) => void } = {}
): Promise<AIRun> {
  let last: AIRun | null = null
  const controller = new AbortController()
  options.signal?.addEventListener('abort', () => controller.abort(), {
    once: true,
  })
  await followAIRun(run.id, {
    signal: controller.signal,
    onEvent: (event) => {
      const body = (event.data ?? {}) as { phase?: string }
      if (event.type === 'status' && body.phase) options.onPhase?.(body.phase)
      const done = aiRunSchema.safeParse(event.data)
      if (done.success && done.data.status !== 'running') last = done.data
    },
  })
  last ??= aiRunSchema.parse(
    await apiFetch<unknown>(`/api/v1/ai/runs/${run.id}`, {
      signal: options.signal,
    })
  )
  return last
}

/** Turns an ended run into its result, or throws what the server said went wrong. */
export function settleJob(run: AIRun): JobResult {
  const result = run.status === 'completed' ? jobResult(run) : null
  if (!result) {
    throw new Error(
      run.status === 'cancelled'
        ? 'The job was stopped.'
        : run.error || 'The job did not finish. Try again.'
    )
  }
  return result
}

/**
 * Runs a connection test, or a test followed by a save, on the server. The key
 * travels only in this request; the run keeps no copy of it.
 */
export async function runSettingJob(
  purpose: Purpose,
  operation: 'test' | 'save',
  input: SettingInput,
  options: { signal?: AbortSignal; onPhase?: (phase: string) => void } = {}
): Promise<JobResult> {
  const run = aiRunSchema.parse(
    await apiFetch<unknown>(`${path(purpose)}/runs`, {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ ...input, operation }),
      signal: options.signal,
    })
  )
  return settleJob(await awaitJob(run, options))
}

export type EmbeddingProgress = {
  pending: boolean
  model?: string
  done?: number
  total?: number
}

/**
 * Follows the re-embedding of documents. Each event is the whole current state,
 * so a dropped connection loses nothing: it asks again until no model is pending.
 */
export async function followEmbeddingProgress(
  signal: AbortSignal,
  onProgress: (progress: EmbeddingProgress) => void
): Promise<void> {
  let failures = 0
  while (!signal.aborted && failures < 6) {
    let pending = true
    try {
      const response = await apiStream('/api/v1/platform/ai/embedding/events', {
        headers: { Accept: 'text/event-stream' },
        signal,
      })
      if (!response.body) return
      for await (const event of readEventStream(response.body)) {
        failures = 0
        const progress = event.data as EmbeddingProgress
        onProgress(progress)
        pending = progress.pending
      }
      if (!pending) return
    } catch (error) {
      if (signal.aborted) return
      if (error instanceof ApiError && error.status < 500) return
    }
    failures++
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(300 * 2 ** failures, 5000))
    )
  }
}
