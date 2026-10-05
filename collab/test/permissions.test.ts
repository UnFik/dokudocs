import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { yDocToProsemirrorJSON } from 'y-prosemirror'
import { documentBodySchema } from '../src/schema'
import { createCollabServer, type CollabServer } from '../src/server'
import { connect, FakeBackend, freePort, waitFor } from './support'

const workspace = '11111111-1111-4111-8111-111111111111'
const document = '22222222-2222-4222-8222-222222222222'
const room = `${workspace}.${document}`
const SUGGESTER = '00000000-0000-4000-8000-0000000000a1'
const SUGGESTION = '00000000-0000-4000-8000-0000000000b1'

function documentWith(text: string) {
  const attrs = (id: string) => ({ nodeID: id, bodyAttributes: '{}', bodyContent: '' })
  const nodes = documentBodySchema.nodes
  const run = nodes.run!.create(attrs('run-1'), [documentBodySchema.text(text)])
  const paragraph = nodes.paragraph!.create(attrs('para-1'), [run])
  const root = nodes.document!.create(attrs('root-1'), [paragraph])
  return documentBodySchema.topNodeType.create(null, [root]).toJSON()
}

const textOf = (client: ReturnType<typeof connect>) => (client.doc.getXmlFragment('body').get(0) as any).get(0).get(0).get(0)

describe('someone who may only suggest', () => {
  let backend: FakeBackend
  let server: CollabServer
  let port: number

  beforeEach(async () => {
    backend = new FakeBackend()
    backend.grant('tok-editor', 'editor')
    backend.grant('tok-suggester', SUGGESTER, { canEdit: false, canSuggest: true })
    backend.documents.set(document, { state: null, content: documentWith('hello') })
    port = await freePort()
    server = await createCollabServer({ backend, port, debounceMs: 20, maxDebounceMs: 100 })
  })
  afterEach(async () => {
    await server.stop()
  })

  it('reaches the others with a suggestion of their own', async () => {
    const editor = connect(port, room, 'tok-editor')
    const suggester = connect(port, room, 'tok-suggester')
    await Promise.all([editor.synced, suggester.synced])

    textOf(suggester).insert(5, ' world', { suggestion_insert: { id: SUGGESTION, author: SUGGESTER } })

    await waitFor(() => JSON.stringify(yDocToProsemirrorJSON(editor.doc, 'body')).includes(' world'))
    editor.provider.destroy()
    suggester.provider.destroy()
  })

  it('is kept from changing the canonical text', async () => {
    const editor = connect(port, room, 'tok-editor')
    const suggester = connect(port, room, 'tok-suggester')
    await Promise.all([editor.synced, suggester.synced])

    textOf(suggester).insert(5, ' vandalism')
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(JSON.stringify(yDocToProsemirrorJSON(editor.doc, 'body'))).not.toContain('vandalism')
    editor.provider.destroy()
    suggester.provider.destroy()
  })

  it('is kept from writing a suggestion in someone else’s name', async () => {
    const editor = connect(port, room, 'tok-editor')
    const suggester = connect(port, room, 'tok-suggester')
    await Promise.all([editor.synced, suggester.synced])

    const other = '00000000-0000-4000-8000-0000000000a2'
    textOf(suggester).insert(5, ' forged', { suggestion_insert: { id: SUGGESTION, author: other } })
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(JSON.stringify(yDocToProsemirrorJSON(editor.doc, 'body'))).not.toContain('forged')
    editor.provider.destroy()
    suggester.provider.destroy()
  })
})
