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

describe('a round trip to the room', () => {
  it('answers a ping after everything the client sent before it', async () => {
    const backend = new FakeBackend()
    backend.grant('tok', 'user-a')
    const port = await freePort()
    const server = await createCollabServer({ backend, port })
    const client = connect(port, room(doc(1)), 'tok')
    await client.synced

    client.doc.getText('scratch').insert(0, 'before the ping')
    client.provider.sendStateless(JSON.stringify({ type: 'ping', id: 'p1' }))

    await waitFor(() => client.statelessMessages.some((m: any) => m.type === 'pong' && m.id === 'p1'))
    client.provider.destroy()
    await server.stop()
  })
})

describe('storing a room', () => {
  it('never lets an older store overwrite a newer one', async () => {
    const backend = new FakeBackend()
    backend.grant('tok', 'user-a')
    // The first store is slow, as one stuck in a queue would be.
    let calls = 0
    const stored = backend.storeState.bind(backend)
    backend.storeState = async (document) => {
      const mine = ++calls
      await new Promise((resolve) => setTimeout(resolve, mine === 1 ? 300 : 0))
      await stored(document)
    }
    const port = await freePort()
    const server = await createCollabServer({ backend, port, debounceMs: 20, maxDebounceMs: 40 })
    const client = connect(port, room(doc(1)), 'tok')
    await client.synced

    client.doc.getText('scratch').insert(0, 'first')
    await new Promise((resolve) => setTimeout(resolve, 80))
    client.doc.getText('scratch').insert(5, ' second')
    await waitFor(() => calls >= 2)
    await new Promise((resolve) => setTimeout(resolve, 500))

    const final = backend.documents.get(doc(1))!
    const text = new (await import('yjs')).Doc()
    ;(await import('yjs')).applyUpdate(text, final.state!)
    expect(text.getText('scratch').toString()).toBe('first second')
    client.provider.destroy()
    await server.stop()
  })
})
