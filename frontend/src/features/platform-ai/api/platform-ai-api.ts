import { z } from 'zod'
import { apiFetch } from '@/lib/api-client'

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
export async function testSettingApi(purpose: Purpose, input: SettingInput) {
  await apiFetch(`${path(purpose)}/test`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
export async function saveSettingApi(purpose: Purpose, input: SettingInput) {
  return overviewSchema.parse(
    await apiFetch(path(purpose), {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  )
}
