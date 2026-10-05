import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { yDocToProsemirrorJSON } from 'y-prosemirror'
import { documentBodySchema } from '../src/schema'
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

    a.doc.getText('scratch').insert(0, 'hello')
    await waitFor(() => b.doc.getText('scratch').toString() === 'hello')

    b.doc.getText('scratch').insert(5, ' world')
    await waitFor(() => a.doc.getText('scratch').toString() === 'hello world')
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

    viewer.doc.getText('scratch').insert(0, 'vandal')
    editor.doc.getText('scratch').insert(0, 'real')
    await waitFor(() => viewer.doc.getText('scratch').toString().includes('real'))
    await new Promise((r) => setTimeout(r, 200))

    expect(editor.doc.getText('scratch').toString()).toBe('real')
    editor.provider.destroy()
    viewer.provider.destroy()
  })

  it('stores the state once the room is empty, and a later editor gets it back', async () => {
    const first = connect(port, room, 'tok-a')
    await first.synced
    first.doc.getText('scratch').insert(0, 'kept')
    await waitFor(() => backend.stores.length > 0)
    first.provider.destroy()

    const stored = backend.stores.at(-1)!
    expect(stored.documentID).toBe(document)
    expect(stored.workspaceID).toBe(workspace)

    const second = connect(port, room, 'tok-b')
    await second.synced
    expect(second.doc.getText('scratch').toString()).toBe('kept')
    second.provider.destroy()
  })

  /** A document of one paragraph, as the editor's schema writes it. */
  function documentWith(text: string) {
    const attrs = (id: string) => ({ nodeID: id, bodyAttributes: '{}', bodyContent: '' })
    const nodes = documentBodySchema.nodes
    const run = nodes.run!.create(attrs('run-1'), [documentBodySchema.text(text)])
    const paragraph = nodes.paragraph!.create(attrs('para-1'), [run])
    const root = nodes.document!.create(attrs('root-1'), [paragraph])
    return documentBodySchema.topNodeType.create(null, [root]).toJSON()
  }

  it('opens a document that has only JSON content, by building its state', async () => {
    const content = documentWith('from json')
    backend.documents.set(document, { state: null, content })
    const client = connect(port, room, 'tok-a')
    await client.synced

    expect(yDocToProsemirrorJSON(client.doc, 'body')).toEqual(content)
    client.provider.destroy()
  })

  it('stores the JSON next to the state, derived from what the editors wrote', async () => {
    backend.documents.set(document, { state: null, content: documentWith('start') })
    const client = connect(port, room, 'tok-a')
    await client.synced

    const run = (client.doc.getXmlFragment('body').get(0) as any).get(0).get(0)
    run.get(0).insert(5, ' more')
    await waitFor(() => backend.stores.length > 0)

    const stored = backend.stores.at(-1)!
    expect(JSON.stringify(stored.content)).toContain('start more')
    expect(stored.content).toEqual(yDocToProsemirrorJSON(client.doc, 'body'))
    client.provider.destroy()
  })

  it('stores what is still waiting when the service stops', async () => {
    await server.stop()
    // A service with a long wait before storing: only stopping can save the edit.
    port = await freePort()
    server = await createCollabServer({ backend, port, debounceMs: 60_000, maxDebounceMs: 120_000 })
    const client = connect(port, room, 'tok-a')
    await client.synced
    client.doc.getText('scratch').insert(0, 'last words')
    await new Promise((r) => setTimeout(r, 200))
    expect(backend.stores).toHaveLength(0)

    await server.stop()

    expect(backend.stores).toHaveLength(1)
    client.provider.destroy()
  })

  it('answers a health check over plain HTTP', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
  })
})

