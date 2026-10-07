import { loadConfig } from './config'
import { HttpBackend } from './http-backend'
import { createCollabServer } from './server'

const config = loadConfig(process.env)
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
console.log(`collaboration service listening on :${config.port}${config.redisURL ? ' (Redis)' : ''}`)

let stopping = false
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    // Stopping stores what is still waiting, so an edit made a moment ago is not lost.
    void server.stop().finally(() => process.exit(0))
  })
}
