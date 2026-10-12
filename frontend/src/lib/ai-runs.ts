import { z } from 'zod'
import { apiFetch, apiStream, ApiError } from '@/lib/api-client'
import { workspaceHeaders } from '@/lib/domain-api'

export const aiRunSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  status: z.enum([
    'running',
    'completed',
    'failed',
    'cancelled',
    'interrupted',
  ]),
  draft: z.string(),
  sequence: z.number(),
  error: z.string().optional().default(''),
  result: z.unknown().optional(),
})
export type AIRun = z.infer<typeof aiRunSchema>

export type AIRunEvent = { id: number; type: string; data: unknown }

const terminalTypes = new Set([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
])
export const isTerminalRun = (status: AIRun['status']) => status !== 'running'

/** Starts an answer on the server and returns at once. A repeated key returns the same run. */
export async function startChatRun(
  workspaceId: string,
  conversationID: string,
  input: {
    question: string
    language: 'id' | 'en'
    publicLinkTokens?: string[]
    categoryIds?: string[]
    contextChatIds?: string[]
    attachments?: { name: string; text: string }[]
  },
  idempotencyKey: string
): Promise<AIRun> {
  return aiRunSchema.parse(
    await apiFetch<unknown>(
      `/api/v1/rag/conversations/${conversationID}/runs`,
      {
        method: 'POST',
        headers: {
          ...workspaceHeaders(workspaceId),
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(input),
      }
    )
  )
}

/** The run in progress on a conversation, or else the last one; null when there is none. */
export async function getLatestChatRun(
  conversationID: string,
  signal?: AbortSignal
): Promise<AIRun | null> {
  const run = await apiFetch<unknown>(
    `/api/v1/rag/conversations/${conversationID}/runs`,
    { signal }
  )
  return run ? aiRunSchema.parse(run) : null
}

export async function cancelAIRun(runID: string): Promise<AIRun> {
  return aiRunSchema.parse(
    await apiFetch<unknown>(`/api/v1/ai/runs/${runID}/cancel`, {
      method: 'POST',
    })
  )
}

/** Splits a server-sent event stream into events; comment lines (heartbeats) are skipped. */
export async function* readEventStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<AIRunEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n')
      let end = buffer.indexOf('\n\n')
      while (end >= 0) {
        const event = parseEvent(buffer.slice(0, end))
        buffer = buffer.slice(end + 2)
        if (event) yield event
        end = buffer.indexOf('\n\n')
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

function parseEvent(block: string): AIRunEvent | null {
  let id = 0
  let type = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'id') id = Number(value) || 0
    else if (field === 'event') type = value
    else if (field === 'data') data.push(value)
  }
  if (data.length === 0) return null
  try {
    return { id, type, data: JSON.parse(data.join('\n')) }
  } catch {
    return null
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })

const maxReconnects = 6

/**
 * Follows a run until it ends. Each event reaches onEvent once, in order: after a
 * dropped connection it asks again from the last event it has. Leaving (abort)
 * only stops watching; the run goes on in the server.
 */
export async function followAIRun(
  runID: string,
  options: {
    after?: number
    signal: AbortSignal
    onEvent: (event: AIRunEvent) => void
  }
): Promise<void> {
  const { signal, onEvent } = options
  let cursor = options.after ?? 0
  let failures = 0
  while (!signal.aborted) {
    let received = false
    try {
      const response = await apiStream(`/api/v1/ai/runs/${runID}/events`, {
        headers: {
          'Last-Event-ID': String(cursor),
          Accept: 'text/event-stream',
        },
        signal,
      })
      if (!response.body) throw new Error('The server sent no event stream')
      for await (const event of readEventStream(response.body)) {
        received = true
        if (event.type === 'snapshot') {
          cursor = event.id
          onEvent(event)
          continue
        }
        if (event.id <= cursor) continue
        cursor = event.id
        onEvent(event)
        if (terminalTypes.has(event.type)) return
      }
    } catch (error) {
      if (signal.aborted) return
      // A refused request will be refused again: sign-in lost, or the run is gone.
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500
      )
        throw error
    }
    if (received) failures = 0
    else if (++failures > maxReconnects)
      throw new Error('The connection to the answer was lost.')
    await sleep(Math.min(300 * 2 ** failures, 5000), signal)
  }
}
