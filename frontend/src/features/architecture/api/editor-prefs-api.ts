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

// Writes run one at a time: each reads the settings and sends them all back, so
// two at once would let the later read lose the earlier key.
let writing: Promise<unknown> = Promise.resolve()

export function writeEditorPref(key: string, value: unknown) {
  return queueWrite('editorPrefs', key, value)
}

/** What a person chose for notifications: in_app, email and push, each on unless set to false. */
export async function readNotificationPrefs(signal?: AbortSignal) {
  const settings = settingsSchema.parse(
    await apiFetch<unknown>('/api/v1/users/me/settings', { signal })
  )
  return parseObject(settings.notificationPrefs)
}

export function writeNotificationPref(key: string, value: unknown) {
  return queueWrite('notificationPrefs', key, value)
}

function queueWrite(
  blob: 'editorPrefs' | 'notificationPrefs',
  key: string,
  value: unknown
) {
  const write = writing.then(() => sendPref(blob, key, value))
  writing = write.catch(() => undefined)
  return write
}

async function sendPref(
  blob: 'editorPrefs' | 'notificationPrefs',
  key: string,
  value: unknown
) {
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
      notificationPrefs:
        blob === 'notificationPrefs'
          ? { ...parseObject(settings.notificationPrefs), [key]: value }
          : parseObject(settings.notificationPrefs),
      editorPrefs:
        blob === 'editorPrefs'
          ? { ...parseObject(settings.editorPrefs), [key]: value }
          : parseObject(settings.editorPrefs),
    }),
  })
}
