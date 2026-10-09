import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'

const base = { COLLAB_BACKEND_URL: 'http://api:8080', COLLAB_SERVICE_SECRET: 's3cret' }

describe('loadConfig', () => {
  it('needs the backend URL and the shared secret', () => {
    expect(() => loadConfig({})).toThrow(/COLLAB_BACKEND_URL/)
    expect(() => loadConfig({ COLLAB_BACKEND_URL: 'http://api:8080' })).toThrow(/COLLAB_SERVICE_SECRET/)
  })

  it('has defaults for the rest, with Redis off', () => {
    expect(loadConfig(base)).toEqual({
      port: 1234,
      backendURL: 'http://api:8080',
      secret: 's3cret',
      redisURL: null,
      debounceMs: 2000,
      maxDebounceMs: 10000,
      maxConnections: 1000,
      maxPayloadBytes: 16 * 1024 * 1024,
      maxMessagesPerSecond: 500,
      otlpEndpoint: null,
    })
  })

  it('exports traces only when an endpoint is set', () => {
    expect(loadConfig({ ...base, OTEL_EXPORTER_OTLP_ENDPOINT: 'http://alloy:4318/' }).otlpEndpoint).toBe('http://alloy:4318')
  })

  it('reads the port, Redis and the store timing', () => {
    expect(
      loadConfig({ ...base, COLLAB_PORT: '4000', REDIS_URL: 'redis://r:6379', COLLAB_DEBOUNCE_MS: '500', COLLAB_MAX_DEBOUNCE_MS: '3000' })
    ).toMatchObject({ port: 4000, redisURL: 'redis://r:6379', debounceMs: 500, maxDebounceMs: 3000 })
  })

  it('refuses a port or a timing that is not a number', () => {
    expect(() => loadConfig({ ...base, COLLAB_PORT: 'abc' })).toThrow(/COLLAB_PORT/)
    expect(() => loadConfig({ ...base, COLLAB_DEBOUNCE_MS: '-1' })).toThrow(/COLLAB_DEBOUNCE_MS/)
  })
})
