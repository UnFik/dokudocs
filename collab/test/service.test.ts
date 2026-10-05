import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCollabServer, type CollabServer } from '../src/server'
import { connect, FakeBackend, freePort, waitFor } from './support'

const workspace = '11111111-1111-4111-8111-111111111111'
const document = '22222222-2222-4222-8222-222222222222'
const room = `${workspace}.${document}`

describe('collaboration service', () => {
  let backend: FakeBackend
  let server: CollabServer
  let port: number

  beforeEach(async () => {
    backend = new FakeBackend()
    backend.grant('tok-a', 'user-a')
    backend.grant('tok-b', 'user-b')
    port = await freePort()
    server = await createCollabServer({ backend, port, debounceMs: 20, maxDebounceMs: 100 })
  })
  afterEach(async () => {
    await server.stop()
  })

  it('two editors converge on the same text', async () => {
    const a = connect(port, room, 'tok-a')
    const b = connect(port, room, 'tok-b')
    await Promise.all([a.synced, b.synced])

    a.doc.getText('body').insert(0, 'hello')
    await waitFor(() => b.doc.getText('body').toString() === 'hello')

    b.doc.getText('body').insert(5, ' world')
    await waitFor(() => a.doc.getText('body').toString() === 'hello world')
    a.provider.destroy()
    b.provider.destroy()
  })

  it('refuses a token the backend does not know', async () => {
    const stranger = connect(port, room, 'tok-unknown')
    await expect(stranger.refused).resolves.toBeTruthy()
    stranger.provider.destroy()
  })

  it('does not let a viewer change the document', async () => {
    backend.grant('tok-viewer', 'user-v', { canEdit: false, canSuggest: false })
    const editor = connect(port, room, 'tok-a')
    const viewer = connect(port, room, 'tok-viewer')
    await Promise.all([editor.synced, viewer.synced])

    viewer.doc.getText('body').insert(0, 'vandal')
    editor.doc.getText('body').insert(0, 'real')
    await waitFor(() => viewer.doc.getText('body').toString().includes('real'))
    await new Promise((r) => setTimeout(r, 200))

    expect(editor.doc.getText('body').toString()).toBe('real')
    editor.provider.destroy()
    viewer.provider.destroy()
  })

  it('stores the state once the room is empty, and a later editor gets it back', async () => {
    const first = connect(port, room, 'tok-a')
    await first.synced
    first.doc.getText('body').insert(0, 'kept')
    await waitFor(() => backend.stores.length > 0)
    first.provider.destroy()

    const stored = backend.stores.at(-1)!
    expect(stored.documentID).toBe(document)
    expect(stored.workspaceID).toBe(workspace)

    const second = connect(port, room, 'tok-b')
    await second.synced
    expect(second.doc.getText('body').toString()).toBe('kept')
    second.provider.destroy()
  })
})

