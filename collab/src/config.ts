export type Config = {
  port: number
  backendURL: string
  secret: string
  /** When set, several instances share rooms through Redis. */
  redisURL: string | null
  debounceMs: number
  maxDebounceMs: number
  maxConnections: number
  maxPayloadBytes: number
  maxMessagesPerSecond: number
}

function whole(env: Record<string, string | undefined>, name: string, fallback: number, min: number): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min) throw new Error(`${name} must be a whole number of at least ${min}`)
  return value
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const backendURL = env.COLLAB_BACKEND_URL
  if (!backendURL) throw new Error('COLLAB_BACKEND_URL is required')
  const secret = env.COLLAB_SERVICE_SECRET
  if (!secret) throw new Error('COLLAB_SERVICE_SECRET is required')
  return {
    port: whole(env, 'COLLAB_PORT', 1234, 1),
    backendURL,
    secret,
    redisURL: env.REDIS_URL || null,
    debounceMs: whole(env, 'COLLAB_DEBOUNCE_MS', 2000, 0),
    maxDebounceMs: whole(env, 'COLLAB_MAX_DEBOUNCE_MS', 10000, 0),
    maxConnections: whole(env, 'COLLAB_MAX_CONNECTIONS', 1000, 1),
    maxPayloadBytes: whole(env, 'COLLAB_MAX_PAYLOAD_BYTES', 16 * 1024 * 1024, 1024),
    maxMessagesPerSecond: whole(env, 'COLLAB_MAX_MESSAGES_PER_SECOND', 500, 1),
  }
}
