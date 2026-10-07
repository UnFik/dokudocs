import type { Extension } from '@hocuspocus/server'

/** Counters for what the service is doing, shown in Prometheus text at /metrics. */
const buckets = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1]

export class Metrics {
  connections = 0
  rooms = 0
  stores = 0
  storeFailures = 0
  private refused = new Map<string, number>()
  private messageBuckets = buckets.map(() => 0)
  private messageCount = 0
  private messageSum = 0

  observeMessage(seconds: number) {
    this.messageCount++
    this.messageSum += seconds
    buckets.forEach((limit, index) => {
      if (seconds <= limit) this.messageBuckets[index]!++
    })
  }

  refuse(reason: string) {
    this.refused.set(reason, (this.refused.get(reason) ?? 0) + 1)
  }

  render() {
    const lines = [
      '# TYPE collab_connections gauge',
      `collab_connections ${this.connections}`,
      '# TYPE collab_rooms gauge',
      `collab_rooms ${this.rooms}`,
      '# TYPE collab_stores_total counter',
      `collab_stores_total ${this.stores}`,
      '# TYPE collab_store_failures_total counter',
      `collab_store_failures_total ${this.storeFailures}`,
      '# TYPE collab_refused_total counter',
      ...[...this.refused].map(([reason, count]) => `collab_refused_total{reason="${reason}"} ${count}`),
      '# TYPE collab_message_seconds histogram',
      ...buckets.map((limit, index) => `collab_message_seconds_bucket{le="${limit}"} ${this.messageBuckets[index]}`),
      `collab_message_seconds_bucket{le="+Inf"} ${this.messageCount}`,
      `collab_message_seconds_sum ${this.messageSum}`,
      `collab_message_seconds_count ${this.messageCount}`,
    ]
    return lines.join('\n') + '\n'
  }
}

/** One JSON line per event, so a log collector can read the fields. */
export function log(event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }))
}

export function instrumentation(metrics: Metrics, maxMessagesPerSecond: number): Extension {
  const started = new WeakMap<object, number>()
  const windows = new WeakMap<object, { start: number; count: number }>()
  return {
    extensionName: 'instrumentation',
    async beforeHandleMessage({ connection }) {
      const now = Date.now()
      const window = windows.get(connection)
      if (!window || now - window.start >= 1000) windows.set(connection, { start: now, count: 1 })
      else if (++window.count > maxMessagesPerSecond) {
        metrics.refuse('rate_limited')
        log('connection_refused', { reason: 'rate_limited' })
        throw Object.assign(new Error('rate_limited'), { reason: 'rate_limited' })
      }
      started.set(connection, performance.now())
    },
    async afterHandleMessage({ connection }) {
      const begin = started.get(connection)
      if (begin !== undefined) metrics.observeMessage((performance.now() - begin) / 1000)
    },
    async connected({ documentName }) {
      metrics.connections++
      log('connected', { room: documentName, connections: metrics.connections })
    },
    async onDisconnect({ documentName }) {
      metrics.connections = Math.max(0, metrics.connections - 1)
      log('disconnected', { room: documentName, connections: metrics.connections })
    },
    async onLoadDocument() {
      metrics.rooms++
    },
    async afterUnloadDocument() {
      metrics.rooms = Math.max(0, metrics.rooms - 1)
    },
    async afterStoreDocument({ documentName }) {
      metrics.stores++
      log('stored', { room: documentName })
    },
  }
}
