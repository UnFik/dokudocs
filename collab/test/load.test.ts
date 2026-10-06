import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCollabServer, type CollabServer } from '../src/server'
import { connect, FakeBackend, freePort, waitFor } from './support'

// A local measurement, not capacity planning: it only guards against the
// service getting much slower. Run with COLLAB_LOAD=1.
const run = process.env.COLLAB_LOAD ? describe : describe.skip

run('collaboration load', () => {
  let server: CollabServer
  let port: number
  const backend = new FakeBackend()
  const workspace = '11111111-1111-4111-8111-111111111111'

  beforeAll(async () => {
    backend.grant('tok', 'user')
    port = await freePort()
    server = await createCollabServer({ backend, port, debounceMs: 200, maxDebounceMs: 1000 })
  })
  afterAll(async () => {
    await server.stop()
  })

  it('keeps 60 editors in one room converged, with edits reaching all of them in time', async () => {
    const room = `${workspace}.22222222-2222-4222-8222-000000000001`
    const clients = Array.from({ length: 60 }, () => connect(port, room, 'tok'))
    await Promise.all(clients.map((client) => client.synced))

    const started = Date.now()
    clients.forEach((client, index) => client.doc.getText('scratch').insert(0, `${index},`))
    await waitFor(
      () => clients.every((client) => client.doc.getText('scratch').toString().split(',').length === 61),
      15000
    )
    const elapsed = Date.now() - started

    const texts = new Set(clients.map((client) => client.doc.getText('scratch').toString()))
    expect(texts.size).toBe(1)
    expect(elapsed).toBeLessThan(5000)
    clients.forEach((client) => client.provider.destroy())
  }, 60000)

  it('serves 100 rooms with 3 editors each', async () => {
    const rooms = Array.from({ length: 100 }, (_, index) => ({
      name: `${workspace}.33333333-3333-4333-8333-${String(index).padStart(12, '0')}`,
    }))
    const clients = rooms.flatMap((room) => Array.from({ length: 3 }, () => connect(port, room.name, 'tok')))
    await Promise.all(clients.map((client) => client.synced))

    clients.forEach((client, index) => client.doc.getText('scratch').insert(0, `${index % 3}`))
    const converged = () =>
      rooms.filter((_, index) => {
        const group = clients.slice(index * 3, index * 3 + 3)
        return group.every((x) => x.doc.getText('scratch').toString().split('').sort().join('') === '012')
      }).length
    await waitFor(
      () =>
        rooms.every((_, index) => {
          const [a, b, c] = clients.slice(index * 3, index * 3 + 3)
          const text = (x: typeof a) => x!.doc.getText('scratch').toString().split('').sort().join('')
          return text(a) === '012' && text(b) === '012' && text(c) === '012'
        }),
      20000
    ).catch((error) => {
      throw new Error(`${error.message}: ${converged()} of 100 rooms converged`)
    })
    clients.forEach((client) => client.provider.destroy())
  }, 60000)
})
