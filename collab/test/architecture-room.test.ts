import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { architectureLimits, seedArchitecture } from '../src/architecture'
import { createCollabServer, type CollabServer } from '../src/server'
import { connect, FakeBackend, freePort, waitFor } from './support'

const workspace = '11111111-1111-4111-8111-111111111111'
const document = '33333333-3333-4333-8333-333333333333'
const room = `${workspace}.${document}`

const addSystem = (doc: Y.Doc, id: string, name = id) => {
  const m = new Y.Map<unknown>()
  doc.getMap('nodes').set(id, m)
  m.set('kind', 'system')
  m.set('name', name)
}

describe('an Architecture room', () => {
  let backend: FakeBackend
  let server: CollabServer
  let port: number

  beforeEach(async () => {
    backend = new FakeBackend()
    backend.grant('tok-a', 'user-a', { documentType: 'architecture' })
    backend.grant('tok-b', 'user-b', { documentType: 'architecture' })
    port = await freePort()
    server = await createCollabServer({ backend, port, debounceMs: 20, maxDebounceMs: 100 })
  })
  afterEach(async () => {
    await server.stop()
  })

  it('lets two editors build the canvas together', async () => {
    const a = connect(port, room, 'tok-a')
    const b = connect(port, room, 'tok-b')
    await Promise.all([a.synced, b.synced])
    addSystem(a.doc, 'order', 'Backend Order')
    addSystem(b.doc, 'pg', 'PostgreSQL')
    await waitFor(() => a.doc.getMap('nodes').size === 2 && b.doc.getMap('nodes').size === 2)
    a.provider.destroy()
    b.provider.destroy()
  })

  it('stores the canvas JSON and a text summary, with no suggestions', async () => {
    const a = connect(port, room, 'tok-a')
    await a.synced
    addSystem(a.doc, 'order', 'Backend Order')
    await waitFor(() => backend.stores.length > 0)
    const stored = backend.stores.at(-1)!
    expect(stored.content).toMatchObject({ version: 1, nodes: [{ id: 'order', name: 'Backend Order' }], connections: [] })
    expect(stored.markdown).toBe('System "Backend Order".')
    expect(stored.suggestions).toEqual([])
    a.provider.destroy()
  })

  it('builds the state from JSON alone, as after a restore', async () => {
    backend.documents.set(document, {
      state: null,
      content: { version: 1, nodes: [{ id: 'pg', kind: 'system', name: 'PostgreSQL' }], connections: [] },
    })
    const a = connect(port, room, 'tok-a')
    await a.synced
    expect((a.doc.getMap('nodes').get('pg') as Y.Map<unknown>).get('name')).toBe('PostgreSQL')
    a.provider.destroy()
  })

  it('keeps someone who can only comment from writing: a canvas has no suggest mode', async () => {
    backend.grant('tok-c', 'user-c', { documentType: 'architecture', canEdit: false, canSuggest: true })
    const editor = connect(port, room, 'tok-a')
    const commenter = connect(port, room, 'tok-c')
    await Promise.all([editor.synced, commenter.synced])
    await waitFor(() => commenter.statelessMessages.some((m: any) => m.type === 'access'))
    expect(commenter.statelessMessages.find((m: any) => m.type === 'access')).toMatchObject({ canEdit: false, canSuggest: false, canComment: true })

    addSystem(commenter.doc, 'vandal')
    addSystem(editor.doc, 'real')
    await waitFor(() => commenter.doc.getMap('nodes').has('real'))
    await new Promise((r) => setTimeout(r, 200))
    expect([...editor.doc.getMap('nodes').keys()]).toEqual(['real'])
    editor.provider.destroy()
    commenter.provider.destroy()
  })

  it('refuses an update that takes the canvas past its element limit', async () => {
    const full = { version: 1, nodes: Array.from({ length: architectureLimits.nodes }, (_, i) => ({ id: `n${String(i).padStart(3, '0')}`, kind: 'system', name: `S${i}` })), connections: [] }
    backend.documents.set(document, { state: seedArchitecture(full), content: full })
    const a = connect(port, room, 'tok-a')
    const b = connect(port, room, 'tok-b')
    await Promise.all([a.synced, b.synced])
    addSystem(a.doc, 'one-too-many')
    await new Promise((r) => setTimeout(r, 300))
    expect(b.doc.getMap('nodes').has('one-too-many')).toBe(false)
    expect(b.doc.getMap('nodes').size).toBe(architectureLimits.nodes)
    a.provider.destroy()
    b.provider.destroy()
  })

  it('tells the editor why its update was refused, so it can stop sending it', async () => {
    const full = { version: 1, nodes: Array.from({ length: architectureLimits.nodes }, (_, i) => ({ id: `n${String(i).padStart(3, '0')}`, kind: 'system', name: `S${i}` })), connections: [] }
    backend.documents.set(document, { state: seedArchitecture(full), content: full })
    const a = connect(port, room, 'tok-a')
    await a.synced
    addSystem(a.doc, 'one-too-many')
    await waitFor(() => a.statelessMessages.some((m: any) => m.type === 'refused'))
    expect(a.statelessMessages.find((m: any) => m.type === 'refused')).toEqual({ type: 'refused', reason: 'too-many-elements' })
    a.provider.destroy()
  })

  it('refuses DBML and Mermaid documents, which have no room', async () => {
    backend.grant('tok-d', 'user-d', { documentType: 'mermaid' })
    const d = connect(port, room, 'tok-d')
    await expect(d.refused).resolves.toBeTruthy()
    d.provider.destroy()
  })
})
