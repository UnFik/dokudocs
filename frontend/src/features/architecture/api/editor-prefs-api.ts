import { z } from 'zod'
import { apiFetch } from '@/lib/api-client'

// The settings endpoint replaces every field at once and refuses unknown ones, so a
// preference is written by reading the settings, changing one key of editorPrefs,
// and sending the fields back (the two preference blobs as JSON objects).
const settingsSchema = z.object({
  theme: z.string().default('system'),
  fontFamily: z.string().default('inter'),
  direction: z.string().default('ltr'),
  language: z.string().default('en'),
  notificationPrefs: z.string().optional().default('{}'),
  editorPrefs: z.string().optional().default('{}'),
})

function parseObject(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export async function readEditorPrefs(signal?: AbortSignal) {
  const settings = settingsSchema.parse(
    await apiFetch<unknown>('/api/v1/users/me/settings', { signal })
  )
  return parseObject(settings.editorPrefs)
}

export async function writeEditorPref(key: string, value: unknown) {
  const settings = settingsSchema.parse(
    await apiFetch<unknown>('/api/v1/users/me/settings')
  )
  await apiFetch('/api/v1/users/me/settings', {
    method: 'PUT',
    body: JSON.stringify({
      theme: settings.theme,
      fontFamily: settings.fontFamily,
      direction: settings.direction,
      language: settings.language,
      notificationPrefs: parseObject(settings.notificationPrefs),
      editorPrefs: { ...parseObject(settings.editorPrefs), [key]: value },
    }),
  })
}
