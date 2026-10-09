import { loadConfig } from './config'
import { HttpBackend } from './http-backend'
import { log } from './operations'
import { createCollabServer } from './server'
import { startTracing } from './tracing'

const config = loadConfig(process.env)
const stopTracing = startTracing(config.otlpEndpoint)
const server = await createCollabServer({
  backend: new HttpBackend(config.backendURL, config.secret),
  port: config.port,
  redisURL: config.redisURL,
  serviceSecret: config.secret,
  debounceMs: config.debounceMs,
  maxDebounceMs: config.maxDebounceMs,
  maxConnections: config.maxConnections,
  maxPayloadBytes: config.maxPayloadBytes,
  maxMessagesPerSecond: config.maxMessagesPerSecond,
})
log('listening', { port: config.port, redis: Boolean(config.redisURL), tracing: Boolean(config.otlpEndpoint) })

let stopping = false
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    // Stopping stores what is still waiting, so an edit made a moment ago is not lost.
    void server
      .stop()
      .then(stopTracing)
      .finally(() => process.exit(0))
  })
}
