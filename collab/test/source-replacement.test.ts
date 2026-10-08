import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCollabServer, type CollabServer } from '../src/server'
import { connect, FakeBackend, freePort, waitFor } from './support'

const workspace = '11111111-1111-4111-8111-111111111111'
const document = '55555555-5555-4555-8555-555555555555'
const recordOne = '66666666-6666-4666-8666-666666666666'
const recordTwo = '77777777-7777-4777-8777-777777777777'
const roomOn = (record: string) => `${workspace}.${document}.${record}`

// A restore replaces a DBML or Mermaid document's record (ADR 0033). Nothing
// from a room or a device copy of the old record may reach the new one.
describe('a source room after a restore', () => {
  let backend: FakeBackend
  let server: CollabServer
  let port: number

  beforeEach(async () => {
    backend = new FakeBackend()
    backend.grant('tok-a', 'user-a', { documentType: 'dbdiagram' })
    backend.replacements.set(document, recordOne)
    backend.documents.set(document, { state: null, content: { source: 'Table restored {}' } })
    port = await freePort()
    server = await createCollabServer({ backend, port, debounceMs: 20, maxDebounceMs: 100, serviceSecret: 's3cret' })
  })
  afterEach(async () => {
    await server.stop()
  })

  it('refuses a device that opens a replaced record, before it can send its edits', async () => {
    backend.replacements.set(document, recordTwo)
    const stale = connect(port, roomOn(recordOne), 'tok-a')
    await expect(stale.refused).resolves.toBe('replaced')
    stale.provider.destroy()
    const current = connect(port, roomOn(recordTwo), 'tok-a')
    await current.synced
    expect(current.doc.getText('source').toString()).toBe('Table restored {}')
    current.provider.destroy()
    expect(backend.stores).toEqual([])
  })

  it('refuses a source room that names no record', async () => {
    const unnamed = connect(port, `${workspace}.${document}`, 'tok-a')
    await expect(unnamed.refused).resolves.toBe('replaced')
    unnamed.provider.destroy()
  })

  it('stores nothing over the restored record from a room still open on the old one', async () => {
    const a = connect(port, roomOn(recordOne), 'tok-a')
    await a.synced
    // The restore committed; the API has not yet asked the service to close the room.
    backend.replacements.set(document, recordTwo)
    a.doc.getText('source').insert(0, 'old ')
    await waitFor(() => a.statelessMessages.some((m: any) => m.type === 'reloaded'))
    expect(backend.stores).toEqual([])
    expect(backend.documents.get(document)?.content).toEqual({ source: 'Table restored {}' })
    a.provider.destroy()
  })

  it('closes every room of the document when the API reloads it', async () => {
    const a = connect(port, roomOn(recordOne), 'tok-a')
    await a.synced
    const response = await fetch(`http://127.0.0.1:${port}/internal/reload?room=${workspace}.${document}`, {
      method: 'POST',
      headers: { 'x-collab-secret': 's3cret' },
    })
    expect(response.status).toBe(204)
    await waitFor(() => a.statelessMessages.some((m: any) => m.type === 'reloaded'))
    a.provider.destroy()
  })
})
