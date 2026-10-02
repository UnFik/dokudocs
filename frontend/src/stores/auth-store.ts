import { create } from 'zustand'
import { getCookie, removeCookie } from '@/lib/cookies'
import { switchLocalUser } from '@/lib/local-user-data'
import {
  authResponseSchema,
  readTokenClaims,
  type AuthResponse,
  type AuthUser,
} from '@/features/auth/api/auth-schema'

const ACCESS_TOKEN = 'thisisjustarandomstring'
const SESSION_MARKER = 'dokudocs-auth-session'
type Session =
  | { status: 'guest'; accessToken: ''; user: null }
  | { status: 'restoring'; accessToken: string; user: null }
  | { status: 'offline'; accessToken: string; user: null }
  | { status: 'authenticated'; accessToken: string; user: AuthUser }
type AuthState = {
  auth: Session & {
    revision: number
    setSession: (session: AuthResponse) => void
    restoreUser: (user: AuthUser, revision: number) => boolean
    enterOffline: (expectedToken: string) => boolean
    reset: () => void
  }
}

function cookieToken() {
  const value = getCookie(ACCESS_TOKEN) ?? ''
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'string' ? parsed : ''
  } catch {
    return value
  }
}
function storedSession(): Session {
  const accessToken = cookieToken()
  if (readTokenClaims(accessToken))
    return { status: 'restoring', accessToken, user: null }
  removeCookie(ACCESS_TOKEN)
  return { status: 'guest', accessToken: '', user: null }
}
function announce() {
  try {
    localStorage.setItem(SESSION_MARKER, crypto.randomUUID())
  } catch {
    /* Cookies still work when storage is unavailable. */
  }
}
let expiryTimer: ReturnType<typeof setTimeout> | undefined
function scheduleExpiry() {
  clearTimeout(expiryTimer)
  const { accessToken, revision } = useAuthStore.getState().auth
  const claims = readTokenClaims(accessToken)
  if (claims)
    expiryTimer = setTimeout(
      () => {
        const current = useAuthStore.getState().auth
        if (current.revision !== revision) return
        const stored = cookieToken()
        if (stored && stored !== current.accessToken) {
          synchronizeSession()
          return
        }
        if (readTokenClaims(current.accessToken)) scheduleExpiry()
        else current.reset()
      },
      Math.min(claims.exp * 1000 - Date.now(), 2_147_483_647)
    )
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  auth: {
    ...storedSession(),
    revision: 0,
    setSession: (input) => {
      const { accessToken, user } = authResponseSchema.parse(input)
      const claims = readTokenClaims(accessToken)
      if (!claims || claims.sub !== user.id || claims.exp !== user.exp)
        throw new Error('Invalid session response')
      switchLocalUser(user.id)
      document.cookie = `${ACCESS_TOKEN}=${accessToken}; Path=/; Max-Age=${Math.max(0, Math.floor(claims.exp - Date.now() / 1000))}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
      set(({ auth }) => ({
        auth: {
          ...auth,
          status: 'authenticated',
          user,
          accessToken,
          revision: auth.revision + 1,
        },
      }))
      announce()
      scheduleExpiry()
    },
    restoreUser: (user, revision) => {
      const auth = get().auth
      const claims = readTokenClaims(auth.accessToken)
      if (
        auth.revision !== revision ||
        !claims ||
        claims.sub !== user.id ||
        claims.exp !== user.exp
      )
        return false
      switchLocalUser(user.id)
      set({ auth: { ...auth, status: 'authenticated', user } })
      scheduleExpiry()
      return true
    },
    enterOffline: (expectedToken) => {
      const auth = get().auth
      if (
        auth.accessToken !== expectedToken ||
        !readTokenClaims(expectedToken)
      )
        return false
      set({ auth: { ...auth, status: 'offline', user: null } })
      return true
    },
    reset: () => {
      switchLocalUser(null)
      removeCookie(ACCESS_TOKEN)
      clearTimeout(expiryTimer)
      set(({ auth }) => ({
        auth: {
          ...auth,
          status: 'guest',
          accessToken: '',
          user: null,
          revision: auth.revision + 1,
        },
      }))
      announce()
    },
  },
}))

export function synchronizeSession(force = false) {
  const auth = useAuthStore.getState().auth
  const token = cookieToken()
  if (
    !force &&
    token === auth.accessToken &&
    (!token || readTokenClaims(token))
  )
    return
  switchLocalUser(null)
  useAuthStore.setState({
    auth: { ...auth, ...storedSession(), revision: auth.revision + 1 },
  })
  scheduleExpiry()
}

export function startAuthSync() {
  const onStorage = (event: StorageEvent) => {
    if (event.key === SESSION_MARKER || event.key === null)
      synchronizeSession(true)
  }
  const onVisibility = () => {
    if (document.visibilityState === 'visible') synchronizeSession()
  }
  window.addEventListener('storage', onStorage)
  const onFocus = () => synchronizeSession()
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibility)
  synchronizeSession()
  scheduleExpiry()
  return () => {
    clearTimeout(expiryTimer)
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
