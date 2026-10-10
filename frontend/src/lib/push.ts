import { z } from 'zod'
import { apiFetch } from '@/lib/api-client'

const configSchema = z.object({
  enabled: z.boolean(),
  vapidKey: z.string().optional(),
  firebase: z
    .object({
      apiKey: z.string(),
      projectId: z.string(),
      appId: z.string(),
      messagingSenderId: z.string(),
    })
    .optional(),
})
export type PushConfig = z.infer<typeof configSchema>

/** Whether push is set up on the server, and with what settings a browser registers. */
export async function fetchPushConfig(signal?: AbortSignal) {
  return configSchema.parse(
    await apiFetch<unknown>('/api/v1/push/config', { signal })
  )
}

export type PushStatus =
  | 'unsupported'
  | 'unavailable'
  | 'blocked'
  | 'off'
  | 'on'

/** What the settings page says about this browser. */
export function describePush(input: {
  supported: boolean
  serverEnabled: boolean
  permission: NotificationPermission
  hasToken: boolean
}): PushStatus {
  if (!input.supported) return 'unsupported'
  if (!input.serverEnabled) return 'unavailable'
  if (input.permission === 'denied') return 'blocked'
  return input.permission === 'granted' && input.hasToken ? 'on' : 'off'
}

export type PushDeps = {
  requestPermission: () => Promise<NotificationPermission>
  /** A token for this browser, from Firebase and the server's settings. */
  getToken: (config: PushConfig) => Promise<string>
  deleteToken: () => Promise<void>
  register: (token: string) => Promise<void>
  unregister: (token: string) => Promise<void>
  storedToken: () => string | null
  storeToken: (token: string) => void
  clearToken: () => void
}

/** Turns notifications on for this browser. Nothing is remembered unless the server accepted the token. */
export async function enablePush(config: PushConfig, deps: PushDeps) {
  if (!config.enabled || !config.firebase || !config.vapidKey) {
    throw new Error('Browser notifications are not set up on this server.')
  }
  if ((await deps.requestPermission()) !== 'granted') {
    throw new Error(
      'Notifications are blocked for this site. Allow them in the browser settings, then try again.'
    )
  }
  const token = await deps.getToken(config)
  await deps.register(token)
  deps.storeToken(token)
}

/** Turns them off: the server forgets this browser, and so does Firebase, even if the server cannot be reached. */
export async function disablePush(deps: PushDeps) {
  const token = deps.storedToken()
  if (!token) return
  try {
    await deps.unregister(token)
  } finally {
    try {
      await deps.deleteToken()
    } finally {
      deps.clearToken()
    }
  }
}

const TOKEN_KEY = 'dokudocs-push-token'
const SCOPE = '/firebase-cloud-messaging-push-scope'

export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window

export const currentPermission = (): NotificationPermission =>
  typeof Notification === 'undefined' ? 'denied' : Notification.permission

/** Firebase is loaded when someone turns notifications on, not for everyone. */
async function messaging(config: PushConfig) {
  const [{ initializeApp, getApps }, { getMessaging }] = await Promise.all([
    import('firebase/app'),
    import('firebase/messaging'),
  ])
  const app = getApps()[0] ?? initializeApp(config.firebase!)
  return getMessaging(app)
}

let lastConfig: PushConfig | null = null

export const browserDeps: PushDeps = {
  requestPermission: () => Notification.requestPermission(),
  async getToken(config) {
    lastConfig = config
    const registration = await navigator.serviceWorker.register(
      '/firebase-messaging-sw.js',
      { scope: SCOPE }
    )
    const { getToken } = await import('firebase/messaging')
    return getToken(await messaging(config), {
      vapidKey: config.vapidKey,
      serviceWorkerRegistration: registration,
    })
  },
  async deleteToken() {
    if (!lastConfig) lastConfig = await fetchPushConfig()
    if (!lastConfig.enabled) return
    const { deleteToken } = await import('firebase/messaging')
    await deleteToken(await messaging(lastConfig))
  },
  register: (token) =>
    apiFetch('/api/v1/users/me/push-tokens', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  unregister: (token) =>
    apiFetch('/api/v1/users/me/push-tokens', {
      method: 'DELETE',
      body: JSON.stringify({ token }),
    }),
  storedToken: () => {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  storeToken: (token) => {
    try {
      localStorage.setItem(TOKEN_KEY, token)
    } catch {
      // The token still works this session; it is only forgotten on reload.
    }
  },
  clearToken: () => {
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
      // Nothing was stored.
    }
  },
}
