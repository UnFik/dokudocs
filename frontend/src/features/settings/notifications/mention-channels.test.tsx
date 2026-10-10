import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { MentionChannels } from './mention-channels'

const push = vi.hoisted(() => ({
  supported: true,
  config: {
    enabled: true,
    vapidKey: 'v',
    firebase: {
      apiKey: 'k',
      projectId: 'p',
      appId: 'a',
      messagingSenderId: '1',
    },
  } as {
    enabled: boolean
  },
  token: null as string | null,
  permission: 'default' as NotificationPermission,
  enable: vi.fn(),
  disable: vi.fn(),
}))
vi.mock('@/lib/push', async (original) => ({
  ...(await original<typeof import('@/lib/push')>()),
  pushSupported: () => push.supported,
  fetchPushConfig: async () => push.config,
  currentPermission: () => push.permission,
  enablePush: push.enable,
  disablePush: push.disable,
  browserDeps: { storedToken: () => push.token },
}))

const settings = (prefs: Record<string, unknown>) => ({
  userId: testSession().user.id,
  theme: 'dark',
  fontFamily: 'inter',
  direction: 'ltr',
  language: 'en',
  notificationPrefs: JSON.stringify(prefs),
  editorPrefs: '{"view_mode":"split"}',
  updatedAt: '2026-10-10T00:00:00Z',
})

beforeEach(() => {
  push.supported = true
  push.config = {
    enabled: true,
    vapidKey: 'v',
    firebase: {
      apiKey: 'k',
      projectId: 'p',
      appId: 'a',
      messagingSenderId: '1',
    },
  } as never
  push.token = null
  push.permission = 'default'
  push.enable.mockReset().mockResolvedValue(undefined)
  push.disable.mockReset().mockResolvedValue(undefined)
  useAuthStore.getState().auth.setSession(testSession())
})
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

function stub(initial: Record<string, unknown>) {
  let prefs = initial
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT')
      prefs = JSON.parse(String(init.body)).notificationPrefs
    return jsonResponse(settings(prefs))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const mount = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MentionChannels />
    </QueryClientProvider>
  )

describe('MentionChannels', () => {
  it('shows what is on, with everything on until a person chooses otherwise', async () => {
    stub({})
    const screen = await mount()
    await expect
      .element(screen.getByRole('switch', { name: 'In Dokudocs' }))
      .toBeChecked()
    await expect
      .element(screen.getByRole('switch', { name: 'By email' }))
      .toBeChecked()
    await expect
      .element(screen.getByRole('switch', { name: 'In this browser' }))
      .not.toBeChecked()
  })

  it('turning email off saves that one choice and keeps the rest of the settings', async () => {
    const fetch = stub({ in_app: true, other: 1 })
    const screen = await mount()
    await screen.getByRole('switch', { name: 'By email' }).click()
    await vi.waitFor(() => {
      const put = fetch.mock.calls.find(([, init]) => init?.method === 'PUT')
      expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({
        theme: 'dark',
        notificationPrefs: { in_app: true, other: 1, email: false },
        editorPrefs: { view_mode: 'split' },
      })
    })
    await expect
      .element(screen.getByRole('switch', { name: 'By email' }))
      .not.toBeChecked()
  })

  it('turns browser notifications on for this browser', async () => {
    stub({})
    const screen = await mount()
    await screen.getByRole('switch', { name: 'In this browser' }).click()
    await vi.waitFor(() => expect(push.enable).toHaveBeenCalledOnce())
  })

  it('shows this browser as on when it is registered and allowed', async () => {
    push.token = 'tok'
    push.permission = 'granted'
    stub({})
    const screen = await mount()
    await expect
      .element(screen.getByRole('switch', { name: 'In this browser' }))
      .toBeChecked()
    await screen.getByRole('switch', { name: 'In this browser' }).click()
    await vi.waitFor(() => expect(push.disable).toHaveBeenCalledOnce())
  })

  it('says why the browser switch is not available', async () => {
    stub({})
    for (const [setup, message] of [
      [
        () => {
          push.supported = false
        },
        /cannot show notifications/i,
      ],
      [
        () => {
          push.config = { enabled: false }
        },
        /not set up on this server/i,
      ],
      [
        () => {
          push.permission = 'denied'
        },
        /blocked for this site/i,
      ],
    ] as const) {
      push.supported = true
      push.config = { enabled: true } as never
      push.permission = 'default'
      setup()
      const screen = await mount()
      await expect.element(screen.getByText(message)).toBeVisible()
      await expect
        .element(screen.getByRole('switch', { name: 'In this browser' }))
        .toBeDisabled()
      await screen.unmount()
    }
  })

  it('says so when turning notifications on fails', async () => {
    stub({})
    push.enable.mockRejectedValue(new Error('The server refused this browser.'))
    const screen = await mount()
    await screen.getByRole('switch', { name: 'In this browser' }).click()
    await expect
      .element(screen.getByText('The server refused this browser.'))
      .toBeVisible()
    await expect
      .element(screen.getByRole('switch', { name: 'In this browser' }))
      .not.toBeChecked()
  })

  it('says so when the settings cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 }))
    )
    const screen = await mount()
    await expect
      .element(screen.getByText(/Could not load your notification settings/))
      .toBeVisible()
  })
})
