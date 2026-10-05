import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCollabServer, type CollabServer } from '../src/server'
import { connect, FakeBackend, freePort, waitFor } from './support'

const workspace = '11111111-1111-4111-8111-111111111111'
const document = '22222222-2222-4222-8222-222222222222'
const room = `${workspace}.${document}`

// A restored revision replaces the document in the API; the room that is open
// must close, without storing what it holds over the restored copy.
describe('reloading a room', () => {
  let backend: FakeBackend
  let server: CollabServer
  let port: number
  const reload = (secret: string | null) =>
    fetch(`http://127.0.0.1:${port}/internal/reload?room=${room}`, {
      method: 'POST',
      headers: secret ? { 'x-collab-secret': secret } : {},
    })

  beforeEach(async () => {
    backend = new FakeBackend()
    backend.grant('tok-a', 'user-a')
    port = await freePort()
    server = await createCollabServer({ backend, port, debounceMs: 20, maxDebounceMs: 100, serviceSecret: 's3cret' })
  })
  afterEach(async () => {
    await server.stop()
  })

  it('refuses a request without the service secret', async () => {
    expect((await reload(null)).status).toBe(401)
    expect((await reload('wrong')).status).toBe(401)
  })

  it('tells the editors, closes the room and does not store it', async () => {
    const client = connect(port, room, 'tok-a')
    await client.synced
    client.doc.getText('scratch').insert(0, 'unsaved')

    expect((await reload('s3cret')).status).toBe(204)
    await waitFor(() => client.statelessMessages.some((m: any) => m.type === 'reloaded'))
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(backend.stores).toHaveLength(0)
    client.provider.destroy()
  })

  it('answers 204 for a room nobody has open', async () => {
    expect((await reload('s3cret')).status).toBe(204)
  })
})
