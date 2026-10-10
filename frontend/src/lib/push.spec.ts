import { describe, expect, it, vi } from 'vitest'
import {
  describePush,
  disablePush,
  enablePush,
  type PushConfig,
  type PushDeps,
} from './push'

const config: PushConfig = {
  enabled: true,
  vapidKey: 'vapid',
  firebase: {
    apiKey: 'key',
    projectId: 'dokudocs',
    appId: 'app',
    messagingSenderId: '123',
  },
}

function deps(
  over: Partial<PushDeps> = {}
): PushDeps & { stored: string | null } {
  const state = { stored: null as string | null }
  const made: PushDeps = {
    requestPermission: vi.fn(async () => 'granted' as NotificationPermission),
    getToken: vi.fn(async () => 'token-1'),
    deleteToken: vi.fn(async () => undefined),
    register: vi.fn(async () => undefined),
    unregister: vi.fn(async () => undefined),
    storedToken: () => state.stored,
    storeToken: (token) => {
      state.stored = token
    },
    clearToken: () => {
      state.stored = null
    },
    ...over,
  }
  return Object.defineProperty(made, 'stored', {
    get: () => state.stored,
  }) as PushDeps & { stored: string | null }
}

describe('describePush', () => {
  const base = {
    supported: true,
    serverEnabled: true,
    permission: 'default' as NotificationPermission,
    hasToken: false,
  }
  it.each([
    [{ supported: false }, 'unsupported'],
    [{ serverEnabled: false }, 'unavailable'],
    [{ permission: 'denied' as NotificationPermission }, 'blocked'],
    [{}, 'off'],
    [{ permission: 'granted' as NotificationPermission }, 'off'],
    [{ permission: 'granted' as NotificationPermission, hasToken: true }, 'on'],
    [
      { permission: 'default' as NotificationPermission, hasToken: true },
      'off',
    ],
  ])('reads %j as %s', (over, status) => {
    expect(describePush({ ...base, ...over })).toBe(status)
  })

  it('puts a browser that cannot do push before everything else', () => {
    expect(
      describePush({
        ...base,
        supported: false,
        serverEnabled: false,
        permission: 'denied',
      })
    ).toBe('unsupported')
  })
})

describe('enablePush', () => {
  it('asks permission, gets a token for the server settings, registers and remembers it', async () => {
    const d = deps()
    await enablePush(config, d)
    expect(d.requestPermission).toHaveBeenCalledOnce()
    expect(d.getToken).toHaveBeenCalledWith(config)
    expect(d.register).toHaveBeenCalledWith('token-1')
    expect(d.stored).toBe('token-1')
  })

  it('stops, and registers nothing, when permission is refused', async () => {
    const d = deps({
      requestPermission: vi.fn(async () => 'denied' as NotificationPermission),
    })
    await expect(enablePush(config, d)).rejects.toThrow(/blocked/i)
    expect(d.getToken).not.toHaveBeenCalled()
    expect(d.register).not.toHaveBeenCalled()
    expect(d.stored).toBeNull()
  })

  it('does not remember a token the server did not accept', async () => {
    const d = deps({
      register: vi.fn(async () => {
        throw new Error('server said no')
      }),
    })
    await expect(enablePush(config, d)).rejects.toThrow('server said no')
    expect(d.stored).toBeNull()
  })

  it('refuses when push is not set up on the server', async () => {
    const d = deps()
    await expect(enablePush({ enabled: false }, d)).rejects.toThrow(
      /not set up/i
    )
    expect(d.requestPermission).not.toHaveBeenCalled()
  })
})

describe('disablePush', () => {
  it('forgets this browser on the server and in the browser', async () => {
    const d = deps()
    await enablePush(config, d)
    await disablePush(d)
    expect(d.unregister).toHaveBeenCalledWith('token-1')
    expect(d.deleteToken).toHaveBeenCalledOnce()
    expect(d.stored).toBeNull()
  })

  it('still clears this browser when the server cannot be reached', async () => {
    const d = deps({
      unregister: vi.fn(async () => {
        throw new Error('offline')
      }),
    })
    await enablePush(config, d)
    await expect(disablePush(d)).rejects.toThrow('offline')
    expect(d.deleteToken).toHaveBeenCalledOnce()
    expect(d.stored).toBeNull()
  })

  it('does nothing when this browser was never registered', async () => {
    const d = deps()
    await disablePush(d)
    expect(d.unregister).not.toHaveBeenCalled()
  })
})
