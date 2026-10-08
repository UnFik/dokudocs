import { z } from 'zod'
import { apiFetch } from '@/lib/api-client'
import { workspaceHeaders } from '@/lib/domain-api'

const useSchema = z.object({
  architectureId: z.string(),
  title: z.string(),
  elementId: z.string(),
  elementKind: z.enum(['system', 'connection']),
  elementName: z.string(),
})
export type ArchitectureUse = z.infer<typeof useSchema>

/** The canvases the reader may open whose elements link to this document. */
export async function listArchitectureUses(
  workspaceID: string,
  documentID: string,
  signal?: AbortSignal
) {
  return z
    .array(useSchema)
    .parse(
      await apiFetch<unknown>(
        `/api/v1/documents/${documentID}/architecture-uses`,
        { headers: workspaceHeaders(workspaceID), signal }
      )
    )
}

const pinSchema = z.object({
  documentId: z.string(),
  title: z.string(),
  documentType: z.string(),
  revisionId: z.string().nullable(),
  versionNumber: z.number().nullable(),
})
const versionSchema = z.object({
  id: z.string(),
  architectureId: z.string(),
  revisionId: z.string(),
  revisionNumber: z.number(),
  label: z.string(),
  description: z.string(),
  createdBy: z.string().nullable(),
  createdByName: z.string(),
  createdAt: z.string(),
  pins: z.array(pinSchema),
})
export type ArchitectureVersion = z.infer<typeof versionSchema>

const versionsPath = (documentID: string) =>
  `/api/v1/documents/${documentID}/architecture-versions`

export async function listArchitectureVersions(
  workspaceID: string,
  documentID: string,
  signal?: AbortSignal
) {
  return z.array(versionSchema).parse(
    await apiFetch<unknown>(versionsPath(documentID), {
      headers: workspaceHeaders(workspaceID),
      signal,
    })
  )
}

export async function createArchitectureVersion(
  workspaceID: string,
  documentID: string,
  label: string,
  description: string
) {
  return versionSchema.parse(
    await apiFetch<unknown>(versionsPath(documentID), {
      method: 'POST',
      headers: workspaceHeaders(workspaceID),
      body: JSON.stringify({ label, description }),
    })
  )
}

export async function updateArchitectureVersion(
  workspaceID: string,
  documentID: string,
  versionID: string,
  label: string,
  description: string
) {
  await apiFetch(`${versionsPath(documentID)}/${versionID}`, {
    method: 'PATCH',
    headers: workspaceHeaders(workspaceID),
    body: JSON.stringify({ label, description }),
  })
}

export async function deleteArchitectureVersion(
  workspaceID: string,
  documentID: string,
  versionID: string
) {
  await apiFetch(`${versionsPath(documentID)}/${versionID}`, {
    method: 'DELETE',
    headers: workspaceHeaders(workspaceID),
  })
}

const myRequestSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['open', 'added', 'declined']),
  resolvedSlug: z.string().nullable(),
  declineReason: z.string(),
  votes: z.number(),
})
export type MyCatalogRequest = z.infer<typeof myRequestSchema>

const openRequestSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  website: z.string(),
  note: z.string(),
  votes: z.number(),
  createdAt: z.string(),
})
export type OpenCatalogRequest = z.infer<typeof openRequestSchema>

const notificationSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  read: z.boolean(),
  createdAt: z.string(),
})
export type AppNotification = z.infer<typeof notificationSchema>

export async function listMyCatalogRequests(signal?: AbortSignal) {
  return z
    .array(myRequestSchema)
    .parse(await apiFetch<unknown>('/api/v1/catalog/requests/mine', { signal }))
}

/** Open requests for platform admins; anyone else gets a 403. */
export async function listOpenCatalogRequests(signal?: AbortSignal) {
  return z
    .array(openRequestSchema)
    .parse(await apiFetch<unknown>('/api/v1/catalog/requests', { signal }))
}

export async function answerCatalogRequest(
  id: string,
  answer:
    | { status: 'added'; slug: string }
    | { status: 'declined'; reason: string }
) {
  await apiFetch(`/api/v1/catalog/requests/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(answer),
  })
}

export async function listNotifications(signal?: AbortSignal) {
  return z
    .array(notificationSchema)
    .parse(await apiFetch<unknown>('/api/v1/notifications', { signal }))
}

export async function markNotificationsRead() {
  await apiFetch('/api/v1/notifications/read', { method: 'POST' })
}
