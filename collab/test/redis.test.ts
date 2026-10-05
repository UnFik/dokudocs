import { afterEach, describe, expect, it } from 'vitest'
import { createCollabServer, type CollabServer } from '../src/server'
import { connect, FakeBackend, freePort, waitFor } from './support'

// Two instances sharing rooms through Redis. Runs when TEST_REDIS_URL is set.
const redisURL = process.env.TEST_REDIS_URL

describe.skipIf(!redisURL)('several instances through Redis', () => {
  const servers: CollabServer[] = []
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop()))
  })

  it('an edit on one instance reaches an editor connected to the other', async () => {
    const backend = new FakeBackend()
    backend.grant('tok-a', 'user-a')
    backend.grant('tok-b', 'user-b')
    const [portOne, portTwo] = [await freePort(), await freePort()]
    for (const port of [portOne, portTwo])
      servers.push(await createCollabServer({ backend, port, redisURL, debounceMs: 20, maxDebounceMs: 100 }))

    const room = `${'1'.repeat(8)}-1111-4111-8111-111111111111.${'2'.repeat(8)}-2222-4222-8222-222222222222`
    const a = connect(portOne, room, 'tok-a')
    const b = connect(portTwo, room, 'tok-b')
    await Promise.all([a.synced, b.synced])

    a.doc.getText('scratch').insert(0, 'across')
    await waitFor(() => b.doc.getText('scratch').toString() === 'across')
    a.provider.destroy()
    b.provider.destroy()
  })
})
