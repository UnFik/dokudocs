import { z } from 'zod'
import { apiFetch } from '@/lib/api-client'

const capabilitySchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
})
const permissionsSchema = z.object({
  catalog: z.array(capabilitySchema),
  allowed: z.array(z.string()),
})
export type AIPermissions = z.infer<typeof permissionsSchema>

const keySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type MCPKey = z.infer<typeof keySchema>

const auditSchema = z.object({
  at: z.string(),
  keyName: z.string().optional().default(''),
  userName: z.string().optional().default(''),
  tool: z.string(),
  resource: z.string(),
  outcome: z.enum(['ok', 'refused', 'limited', 'error']),
  detail: z.string().optional().default(''),
})
export type AuditEntry = z.infer<typeof auditSchema>

export async function getAIPermissions(signal?: AbortSignal) {
  return permissionsSchema.parse(
    await apiFetch('/api/v1/users/me/ai-permissions', { signal })
  )
}
export async function saveAIPermissions(allowed: string[]) {
  return permissionsSchema.parse(
    await apiFetch('/api/v1/users/me/ai-permissions', {
      method: 'PUT',
      body: JSON.stringify({ allowed }),
    })
  )
}
export async function listMCPKeys(signal?: AbortSignal) {
  return z
    .object({ keys: z.array(keySchema) })
    .parse(await apiFetch('/api/v1/users/me/mcp-keys', { signal })).keys
}
export async function createMCPKey(name: string, expiresInDays: number) {
  return z.object({ key: keySchema, secret: z.string() }).parse(
    await apiFetch('/api/v1/users/me/mcp-keys', {
      method: 'POST',
      body: JSON.stringify({ name, expiresInDays }),
    })
  )
}
export async function revokeMCPKey(id: string) {
  await apiFetch(`/api/v1/users/me/mcp-keys/${id}`, { method: 'DELETE' })
}
export async function listMyAudit(signal?: AbortSignal) {
  return z
    .object({ entries: z.array(auditSchema) })
    .parse(await apiFetch('/api/v1/users/me/mcp-audit', { signal })).entries
}
export async function listAllAudit(signal?: AbortSignal) {
  return z
    .object({ entries: z.array(auditSchema) })
    .parse(await apiFetch('/api/v1/platform/mcp/audit', { signal })).entries
}
