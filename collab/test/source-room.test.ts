import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCollabServer, type CollabServer } from '../src/server'
import { connect, FakeBackend, freePort, waitFor } from './support'

const workspace = '11111111-1111-4111-8111-111111111111'
const document = '44444444-4444-4444-8444-444444444444'
const record = '66666666-6666-4666-8666-666666666666'
// A source room names the record it holds (see source-replacement.test.ts).
const room = `${workspace}.${document}.${record}`

describe('a flush', () => {
  let backend: FakeBackend
  let server: CollabServer
  let port: number

  beforeEach(async () => {
    backend = new FakeBackend()
    backend.replacements.set(document, record)
    backend.grant('tok-a', 'user-a', { documentType: 'dbdiagram' })
    port = await freePort()
    // Nothing would be stored for a minute on its own.
    server = await createCollabServer({ backend, port, debounceMs: 60_000, maxDebounceMs: 60_000 })
  })
  afterEach(async () => {
    await server.stop()
  })

  it('answers once everything sent before it is stored in the database', async () => {
    const a = connect(port, room, 'tok-a')
    await a.synced
    a.doc.getText('source').insert(0, 'Table a {}')
    a.provider.sendStateless(JSON.stringify({ type: 'flush', id: 'f1' }))
    await waitFor(() => a.statelessMessages.some((m: any) => m.type === 'stored'))
    expect(a.statelessMessages.find((m: any) => m.type === 'stored')).toEqual({ type: 'stored', id: 'f1', ok: true })
    expect(backend.stores.at(-1)?.markdown).toBe('Table a {}')
    a.provider.destroy()
  })

  it('says so when the database refused the store', async () => {
    const working = backend.storeState.bind(backend)
    backend.storeState = async () => {
      throw new Error('database down')
    }
    const a = connect(port, room, 'tok-a')
    await a.synced
    a.doc.getText('source').insert(0, 'Table a {}')
    a.provider.sendStateless(JSON.stringify({ type: 'flush', id: 'f2' }))
    await waitFor(() => a.statelessMessages.some((m: any) => m.type === 'stored'))
    expect(a.statelessMessages.find((m: any) => m.type === 'stored')).toEqual({ type: 'stored', id: 'f2', ok: false })
    // The server stores what it holds when the room closes; let that succeed.
    backend.storeState = working
    a.provider.destroy()
  })
})

describe('access to an open source room', () => {
  let backend: FakeBackend
  let server: CollabServer
  let port: number

  beforeEach(async () => {
    backend = new FakeBackend()
    backend.replacements.set(document, record)
    backend.grant('tok-a', 'user-a', { documentType: 'mermaid' })
    backend.grant('tok-b', 'user-b', { documentType: 'mermaid' })
    port = await freePort()
    server = await createCollabServer({ backend, port, debounceMs: 20, maxDebounceMs: 100, accessRecheckMs: 50 })
  })
  afterEach(async () => {
    await server.stop()
  })

  it('closes the connection of someone who lost access', async () => {
    const a = connect(port, room, 'tok-a')
    await a.synced
    backend.grant('tok-a', 'user-a', { documentType: 'mermaid', canRead: false, canEdit: false, canSuggest: false })
    await waitFor(() => a.statelessMessages.some((m: any) => m.type === 'refused'))
    expect(a.statelessMessages.find((m: any) => m.type === 'refused')).toEqual({ type: 'refused', reason: 'forbidden' })
    a.provider.destroy()
  })

  it('stops taking edits from an editor who became a viewer', async () => {
    const a = connect(port, room, 'tok-a')
    const b = connect(port, room, 'tok-b')
    await Promise.all([a.synced, b.synced])
    backend.grant('tok-a', 'user-a', { documentType: 'mermaid', canEdit: false, canSuggest: false })
    await waitFor(() => (a.statelessMessages.filter((m: any) => m.type === 'access').at(-1) as any)?.canEdit === false)
    a.doc.getText('source').insert(0, 'late ')
    b.doc.getText('source').insert(0, 'graph TD')
    await waitFor(() => a.doc.getText('source').toString().includes('graph TD'))
    await new Promise((r) => setTimeout(r, 200))
    expect(b.doc.getText('source').toString()).toBe('graph TD')
    a.provider.destroy()
    b.provider.destroy()
  })
})

describe.each(['dbdiagram', 'mermaid'])('a %s room', (documentType) => {
  let backend: FakeBackend
  let server: CollabServer
  let port: number

  beforeEach(async () => {
    backend = new FakeBackend()
    backend.replacements.set(document, record)
    backend.grant('tok-a', 'user-a', { documentType })
    backend.grant('tok-b', 'user-b', { documentType })
    port = await freePort()
    server = await createCollabServer({ backend, port, debounceMs: 20, maxDebounceMs: 100 })
  })
  afterEach(async () => {
    await server.stop()
  })

  it('lets two editors write the source together and stores it as written', async () => {
    const a = connect(port, room, 'tok-a')
    const b = connect(port, room, 'tok-b')
    await Promise.all([a.synced, b.synced])
    a.doc.getText('source').insert(0, 'Table users {\n')
    await waitFor(() => b.doc.getText('source').length > 0)
    b.doc.getText('source').insert(b.doc.getText('source').length, '  id int [pk\n')
    const expected = 'Table users {\n  id int [pk\n'
    await waitFor(() => backend.stores.at(-1)?.markdown === expected)
    const stored = backend.stores.at(-1)!
    expect(stored.content).toEqual({ source: expected })
    expect(stored.suggestions).toEqual([])
    expect(a.doc.getText('source').toString()).toBe(expected)
    a.provider.destroy()
    b.provider.destroy()
  })

  it('builds the text from stored JSON alone, keeping the source as written but with LF line endings', async () => {
    const source = '  graph TD\r\n  A[Café 😀] --> \r\n\t\n'
    backend.documents.set(document, { state: null, content: { source } })
    const a = connect(port, room, 'tok-a')
    const b = connect(port, room, 'tok-b')
    await Promise.all([a.synced, b.synced])
    expect(a.doc.getText('source').toString()).toBe('  graph TD\n  A[Café 😀] --> \n\t\n')
    // Both opened the same seed: the text is there once.
    expect(b.doc.getText('source').toString()).toBe(a.doc.getText('source').toString())
    a.provider.destroy()
    b.provider.destroy()
  })

  it('lets an editor comment, and tells the others when comments change', async () => {
    const editor = connect(port, room, 'tok-a')
    const other = connect(port, room, 'tok-a')
    await Promise.all([editor.synced, other.synced])
    await waitFor(() => editor.statelessMessages.some((m: any) => m.type === 'access'))
    expect(editor.statelessMessages.find((m: any) => m.type === 'access')).toMatchObject({ canEdit: true, canComment: true })
    editor.provider.sendStateless(JSON.stringify({ type: 'comments_changed' }))
    await waitFor(() => other.statelessMessages.some((m: any) => m.type === 'comments_changed'))
    editor.provider.destroy()
    other.provider.destroy()
  })

  it('opens an empty document with empty text', async () => {
    backend.documents.set(document, { state: null, content: { source: '' } })
    const a = connect(port, room, 'tok-a')
    await a.synced
    expect(a.doc.getText('source').toString()).toBe('')
    a.provider.destroy()
  })

  it.each([
    ['viewer', { canEdit: false, canSuggest: false }, false],
    ['commenter', { canEdit: false, canSuggest: true }, true],
  ])('keeps a %s from writing: a source has no suggest mode, and only a commenter may comment', async (_role, access, canComment) => {
    backend.grant('tok-c', 'user-c', { documentType, ...access })
    const editor = connect(port, room, 'tok-a')
    const reader = connect(port, room, 'tok-c')
    await Promise.all([editor.synced, reader.synced])
    await waitFor(() => reader.statelessMessages.some((m: any) => m.type === 'access'))
    expect(reader.statelessMessages.find((m: any) => m.type === 'access')).toEqual({
      type: 'access',
      canEdit: false,
      canSuggest: false,
      canComment,
    })
    reader.doc.getText('source').insert(0, 'vandal ')
    editor.doc.getText('source').insert(0, 'real')
    await waitFor(() => reader.doc.getText('source').toString().includes('real'))
    await new Promise((r) => setTimeout(r, 200))
    expect(editor.doc.getText('source').toString()).toBe('real')
    await waitFor(() => backend.stores.length > 0)
    expect(backend.stores.at(-1)!.markdown).toBe('real')
    editor.provider.destroy()
    reader.provider.destroy()
  })
})
