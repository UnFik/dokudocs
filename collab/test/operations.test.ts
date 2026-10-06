import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCollabServer, type CollabServer } from '../src/server'
import { connect, FakeBackend, freePort, waitFor } from './support'

const workspace = '11111111-1111-4111-8111-111111111111'
const room = (document: string) => `${workspace}.${document}`
const doc = (n: number) => `22222222-2222-4222-8222-00000000000${n}`

async function metrics(port: number) {
  return (await fetch(`http://127.0.0.1:${port}/metrics`)).text()
}

describe('running the service', () => {
  let backend: FakeBackend
  let server: CollabServer
  let port: number

  beforeEach(async () => {
    backend = new FakeBackend()
    backend.grant('tok', 'user-a')
    port = await freePort()
  })
  afterEach(async () => {
    await server.stop()
  })

  it('reports open connections, open rooms and stores in Prometheus text', async () => {
    server = await createCollabServer({ backend, port, debounceMs: 20, maxDebounceMs: 100 })
    const a = connect(port, room(doc(1)), 'tok')
    const b = connect(port, room(doc(2)), 'tok')
    await Promise.all([a.synced, b.synced])

    await waitFor(async () => /^collab_connections 2$/m.test(await metrics(port)))
    expect(await metrics(port)).toMatch(/^collab_rooms 2$/m)

    a.doc.getText('scratch').insert(0, 'x')
    await waitFor(async () => /^collab_stores_total 1$/m.test(await metrics(port)))

    a.provider.destroy()
    await waitFor(async () => /^collab_connections 1$/m.test(await metrics(port)))
    b.provider.destroy()
  })

  it('refuses a connection beyond the limit, and counts the refusal', async () => {
    server = await createCollabServer({ backend, port, maxConnections: 1 })
    const first = connect(port, room(doc(1)), 'tok')
    await first.synced
    const second = connect(port, room(doc(2)), 'tok')

    await expect(second.refused).resolves.toBe('busy')
    expect(await metrics(port)).toMatch(/^collab_refused_total\{reason="busy"\} 1$/m)
    first.provider.destroy()
    second.provider.destroy()
  })

  it('counts refusals for an unknown token', async () => {
    server = await createCollabServer({ backend, port })
    const stranger = connect(port, room(doc(1)), 'nope')
    await stranger.refused
    expect(await metrics(port)).toMatch(/^collab_refused_total\{reason="unauthorized"\} 1$/m)
    stranger.provider.destroy()
  })
})
