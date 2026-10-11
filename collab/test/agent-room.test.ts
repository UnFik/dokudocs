import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { yDocToProsemirrorJSON } from 'y-prosemirror'
import { createCollabServer, type CollabServer } from '../src/server'
import { toMarkdown } from '../src/markdown'
import { connect, FakeBackend, freePort, waitFor } from './support'

const workspace = '11111111-1111-4111-8111-111111111111'
const markdownDoc = '22222222-2222-4222-8222-222222222222'
const sourceDoc = '33333333-3333-4333-8333-333333333333'
const replacement = '44444444-4444-4444-8444-444444444444'
const ME = '00000000-0000-4000-8000-0000000000a1'
const markdownRoom = `${workspace}.${markdownDoc}`
const sourceRoom = `${workspace}.${sourceDoc}.${replacement}`

const attrs = (id: string, extra = {}) => ({ nodeID: id, bodyAttributes: JSON.stringify(extra), bodyContent: '' })
const content = {
  type: 'doc',
  content: [
    {
      type: 'document',
      attrs: attrs('root'),
      content: [
        { type: 'atx_heading', attrs: attrs('h', { level: 2 }), content: [{ type: 'run', attrs: attrs('hr'), content: [{ type: 'text', text: 'Deploy' }] }] },
        { type: 'paragraph', attrs: attrs('p'), content: [{ type: 'run', attrs: attrs('pr'), content: [{ type: 'text', text: 'Push to main.' }] }] },
      ],
    },
  ],
}

describe('agent reads and edits through the room', () => {
  let backend: FakeBackend
  let server: CollabServer
  let port: number
  const call = (path: string, init: RequestInit = {}, secret: string | null = 's3cret') =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(secret ? { 'x-collab-secret': secret } : {}) },
    })
  const read = async (room: string, type: string) => {
    const res = await call(`/internal/agent-read?room=${room}&type=${type}`)
    return { status: res.status, body: (await res.json().catch(() => null)) as { text: string; version: string } }
  }
  const edit = (payload: Record<string, unknown>, secret: string | null = 's3cret') =>
    call('/internal/agent-edit', { method: 'POST', body: JSON.stringify(payload) }, secret)

  beforeEach(async () => {
    backend = new FakeBackend()
    backend.grant('tok-a', 'user-a')
    backend.grant('tok-src', 'user-a', { documentType: 'dbdiagram' })
    backend.documents.set(markdownDoc, { state: null, content })
    backend.documents.set(sourceDoc, { state: null, content: { source: 'Table users {\n  id int\n}\n' } })
    backend.replacements.set(sourceDoc, replacement)
    port = await freePort()
    server = await createCollabServer({ backend, port, debounceMs: 20, maxDebounceMs: 100, serviceSecret: 's3cret' })
  })
  afterEach(async () => {
    await server.stop()
  })

  it('refuses both endpoints without the service secret', async () => {
    expect((await call(`/internal/agent-read?room=${markdownRoom}&type=markdown`, {}, null)).status).toBe(401)
    expect((await edit({ room: markdownRoom }, 'wrong')).status).toBe(401)
  })

  it('reads the live text and its version', async () => {
    const { status, body } = await read(markdownRoom, 'markdown')
    expect(status).toBe(200)
    expect(body.text).toContain('## Deploy')
    expect(body.version).toMatch(/^[0-9a-f]{16}$/)
  })

  it('writes a direct edit that a connected editor receives, and stores it under the user', async () => {
    const client = connect(port, markdownRoom, 'tok-a')
    await client.synced
    const { body } = await read(markdownRoom, 'markdown')
    const res = await edit({
      room: markdownRoom, type: 'markdown', userID: ME, mode: 'direct', baseVersion: body.version,
      operations: [{ type: 'replace_text', find: 'main', replace: 'the release branch' }],
    })
    expect(res.status).toBe(200)
    await waitFor(() => toMarkdown(yDocToProsemirrorJSON(client.doc, 'body')).includes('Push to the release branch.'))
    await waitFor(() => backend.stores.some((stored) => stored.markdown.includes('release branch')))
    expect(backend.stores.at(-1)?.updatedBy).toBe(ME)
    client.provider.destroy()
  })

  it('refuses an edit based on a version that is no longer current', async () => {
    const res = await edit({
      room: markdownRoom, type: 'markdown', userID: ME, mode: 'direct', baseVersion: '0000000000000000',
      operations: [{ type: 'replace_text', find: 'main', replace: 'x' }],
    })
    expect(res.status).toBe(409)
    expect((await read(markdownRoom, 'markdown')).body.text).toContain('Push to main.')
  })

  it('writes a suggestion and names it, leaving the canonical text alone', async () => {
    const { body } = await read(markdownRoom, 'markdown')
    const res = await edit({
      room: markdownRoom, type: 'markdown', userID: ME, mode: 'suggest', baseVersion: body.version,
      operations: [{ type: 'replace_text', find: 'main', replace: 'release' }],
    })
    expect(res.status).toBe(200)
    const result = (await res.json()) as { suggestionIDs: string[] }
    expect(result.suggestionIDs).toHaveLength(1)
    await waitFor(() => backend.stores.some((stored) => stored.suggestions.some((s) => s.id === result.suggestionIDs[0] && s.author === ME)))
  })

  it('answers 422 with the reason for an operation that cannot apply', async () => {
    const res = await edit({ room: markdownRoom, type: 'markdown', userID: ME, mode: 'direct', operations: [{ type: 'replace_text', find: 'absent', replace: 'x' }] })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: string }).error).toContain('not found')
  })

  it('edits a DBML source and refuses suggest mode there', async () => {
    const { body } = await read(sourceRoom, 'dbdiagram')
    expect(body.text).toContain('id int')
    const ok = await edit({ room: sourceRoom, type: 'dbdiagram', userID: ME, mode: 'direct', baseVersion: body.version, operations: [{ type: 'replace_text', find: 'id int', replace: 'id uuid' }] })
    expect(ok.status).toBe(200)
    expect((await read(sourceRoom, 'dbdiagram')).body.text).toContain('id uuid')
    const refused = await edit({ room: sourceRoom, type: 'dbdiagram', userID: ME, mode: 'suggest', operations: [{ type: 'append', text: 'x' }] })
    expect(refused.status).toBe(422)
  })

  it('refuses an Architecture room', async () => {
    const res = await edit({ room: markdownRoom, type: 'architecture', userID: ME, mode: 'direct', operations: [] })
    expect(res.status).toBe(422)
  })
})
