type LocalUserScope = {
  userId: string | null
  generation: number
}

let scope: LocalUserScope = { userId: null, generation: 0 }
const listeners = new Set<() => void>()
const flushers = new Set<() => void>()

export function getLocalUserScope() {
  return scope
}

export function subscribeLocalUser(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function registerLocalUserFlush(flush: () => void) {
  flushers.add(flush)
  return () => flushers.delete(flush)
}

export function isLocalUserScopeCurrent(value: LocalUserScope) {
  return value.generation === scope.generation && value.userId === scope.userId
}

const keyFor = (key: string, userId: string | null) =>
  userId ? `${key}:${userId}` : `dokudocs-guest:${key}`

export function getUserStorage(owner?: LocalUserScope): Storage {
  return {
    get length() {
      const current = owner ?? scope
      return Object.keys(localStorage).filter((key) =>
        key.endsWith(`:${current.userId}`)
      ).length
    },
    clear() {
      throw new Error('Scoped storage cannot be cleared')
    },
    getItem(key) {
      const current = owner ?? scope
      if (!current.userId) return null
      return localStorage.getItem(keyFor(key, current.userId))
    },
    key(index) {
      const current = owner ?? scope
      const keys = Object.keys(localStorage).filter((key) =>
        key.endsWith(`:${current.userId}`)
      )
      return keys[index] ?? null
    },
    removeItem(key) {
      const current = owner ?? scope
      if (current.userId) localStorage.removeItem(keyFor(key, current.userId))
    },
    setItem(key, value) {
      const current = owner ?? scope
      if (!current.userId || !isLocalUserScopeCurrent(current)) return
      localStorage.setItem(keyFor(key, current.userId), value)
    },
  }
}

export function flushLocalUser() {
  for (const flush of flushers) flush()
}

export function switchLocalUser(userId: string | null) {
  if (scope.userId === userId) return
  scope = { userId, generation: scope.generation + 1 }
  for (const listener of listeners) listener()
}
