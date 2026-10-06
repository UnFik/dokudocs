import type { Extension } from '@hocuspocus/server'

/** Counters for what the service is doing, shown in Prometheus text at /metrics. */
export class Metrics {
  connections = 0
  rooms = 0
  stores = 0
  storeFailures = 0
  private refused = new Map<string, number>()

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
    ]
    return lines.join('\n') + '\n'
  }
}

/** One JSON line per event, so a log collector can read the fields. */
export function log(event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }))
}

export function instrumentation(metrics: Metrics): Extension {
  return {
    extensionName: 'instrumentation',
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
