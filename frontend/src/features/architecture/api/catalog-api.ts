import { z } from 'zod'
import { ApiError, apiFetch } from '@/lib/api-client'
import type { CatalogEntry } from '../lib/catalog'

const entrySchema = z.object({
  slug: z.string(),
  category: z.enum(['host', 'system', 'protocol']),
  subkind: z.string(),
  name: z.string(),
  family: z.string().nullable(),
  sortOrder: z.number(),
  deprecated: z.boolean(),
})

export async function fetchCatalog(signal?: AbortSignal): Promise<CatalogEntry[]> {
  const body = z.object({ entries: z.array(entrySchema) }).parse(await apiFetch<unknown>('/api/v1/catalog', { signal }))
  return body.entries
}

export type CatalogRequestInput = {
  workspaceID: string
  name: string
  category: 'host' | 'system' | 'protocol'
  website?: string
  note?: string
}

export type CatalogRequestOutcome =
  | { kind: 'sent'; name: string; votes: number; alreadyRequested: boolean }
  | { kind: 'in-catalog'; slug: string }

const resultSchema = z.object({ id: z.string(), name: z.string(), votes: z.number(), alreadyRequested: z.boolean() })

/** Asks for a missing entry; a name the catalog already has comes back as that entry. */
export async function requestCatalogEntry(input: CatalogRequestInput): Promise<CatalogRequestOutcome> {
  try {
    const result = resultSchema.parse(
      await apiFetch<unknown>('/api/v1/catalog/requests', { method: 'POST', body: JSON.stringify(input) })
    )
    return { kind: 'sent', name: result.name, votes: result.votes, alreadyRequested: result.alreadyRequested }
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const slug = z.object({ data: z.object({ slug: z.string() }) }).safeParse(error.data)
      if (slug.success) return { kind: 'in-catalog', slug: slug.data.data.slug }
    }
    throw error
  }
}
