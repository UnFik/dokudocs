import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { seedArchitecture } from '../src/architecture'
import { createCollabServer, type CollabServer } from '../src/server'
import { connect, FakeBackend, freePort, waitFor } from './support'

const workspace = '11111111-1111-4111-8111-111111111111'
const document = '33333333-3333-4333-8333-333333333333'
const room = `${workspace}.${document}`
const ME = '00000000-0000-4000-8000-0000000000a1'

const canvas = {
  version: 1,
  nodes: [
    { id: 'vps', kind: 'host', parentId: null, x: 40, y: 60, w: 400, h: 240, name: 'VPS-1', catalog: 'vps', tags: [], description: '', repoUrl: null, links: [] },
    { id: 'api', kind: 'system', parentId: 'vps', x: 14, y: 32, w: null, h: null, name: 'API', catalog: 'golang', tags: [], description: '', repoUrl: null, links: [] },
    { id: 'pg', kind: 'system', parentId: 'vps', x: 160, y: 32, w: null, h: null, name: 'PostgreSQL', catalog: 'postgresql', tags: [], description: '', repoUrl: null, links: [] },
  ],
  connections: [{ id: 'c1', source: 'api', target: 'pg', protocol: 'postgres', label: '', port: null, links: [] }],
}

describe('the Agent works on an Architecture room', () => {
  let backend: FakeBackend
  let server: CollabServer
  let port: number
  const call = (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { 'content-type': 'application/json', 'x-collab-secret': 's3cret' } })
  const read = async () => {
    const res = await call(`/internal/agent-read?room=${room}&type=architecture`)
    return { status: res.status, body: (await res.json().catch(() => null)) as { text: string; version: string } }
  }

  beforeEach(async () => {
    backend = new FakeBackend()
    backend.grant('tok-a', 'user-a', { documentType: 'architecture' })
    backend.documents.set(document, { state: seedArchitecture(canvas), content: canvas })
    port = await freePort()
    server = await createCollabServer({ backend, port, debounceMs: 20, maxDebounceMs: 100, serviceSecret: 's3cret' })
  })
  afterEach(async () => {
    await server.stop()
  })

  describe('reading', () => {
    it('returns the canvas as JSON with ids, places and a version', async () => {
      const { status, body } = await read()
      expect(status).toBe(200)
      expect(JSON.parse(body.text)).toMatchObject({
        nodes: [
          { id: 'api', kind: 'system', parentId: 'vps', name: 'API', catalog: 'golang' },
          { id: 'pg', name: 'PostgreSQL' },
          { id: 'vps', kind: 'host', x: 40, y: 60, w: 400, h: 240 },
        ],
        connections: [{ id: 'c1', source: 'api', target: 'pg', protocol: 'postgres' }],
      })
      expect(body.version).toMatch(/^[0-9a-f]{16}$/)
    })

    it('keeps the version when someone only moves or resizes a box, and changes it when the meaning changes', async () => {
      const { body: before } = await read()
      const client = connect(port, room, 'tok-a')
      await client.synced
      const nodes = client.doc.getMap('nodes') as Y.Map<Y.Map<unknown>>
      nodes.get('vps')!.set('x', 500)
      nodes.get('vps')!.set('w', 640)
      await waitFor(async () => JSON.parse((await read()).body.text).nodes.find((n: any) => n.id === 'vps').x === 500)
      expect((await read()).body.version).toBe(before.version)

      nodes.get('api')!.set('name', 'Order API')
      await waitFor(async () => (await read()).body.version !== before.version)
      client.provider.destroy()
    })
  })

  describe('editing', () => {
    const edit = (payload: Record<string, unknown>) =>
      call('/internal/agent-edit', { method: 'POST', body: JSON.stringify({ room, type: 'architecture', userID: ME, mode: 'direct', ...payload }) })

    it('applies operations that a connected editor receives, and answers with the ids it made', async () => {
      const client = connect(port, room, 'tok-a')
      await client.synced
      const { body } = await read()
      const res = await edit({ baseVersion: body.version, operations: [{ type: 'add_node', ref: 'cache', kind: 'system', name: 'Redis', catalog: 'redis', parent: 'vps' }] })
      expect(res.status).toBe(200)
      const answer = (await res.json()) as { version: string; created: Record<string, string>; removed: { nodes: number } }
      expect(answer.version).not.toBe(body.version)
      await waitFor(() => (client.doc.getMap('nodes') as Y.Map<unknown>).has(answer.created.cache!))
      expect(((client.doc.getMap('nodes') as Y.Map<Y.Map<unknown>>).get(answer.created.cache!)!).get('name')).toBe('Redis')
      client.provider.destroy()
    })

    it('stores the change like any editor change', async () => {
      const { body } = await read()
      await edit({ baseVersion: body.version, operations: [{ type: 'update_node', id: 'api', name: 'Order API' }] })
      await waitFor(() => backend.stores.length > 0)
      expect(backend.stores.at(-1)!.content).toMatchObject({ nodes: expect.arrayContaining([expect.objectContaining({ id: 'api', name: 'Order API' })]) })
    })

    it('refuses a version that changed since the Agent read, but not one where only a box moved', async () => {
      const { body } = await read()
      const client = connect(port, room, 'tok-a')
      await client.synced
      const nodes = client.doc.getMap('nodes') as Y.Map<Y.Map<unknown>>
      nodes.get('vps')!.set('x', 900)
      await waitFor(async () => JSON.parse((await read()).body.text).nodes.find((n: any) => n.id === 'vps').x === 900)
      expect((await edit({ baseVersion: body.version, operations: [{ type: 'update_node', id: 'api', name: 'Moved ok' }] })).status).toBe(200)

      const stale = await edit({ baseVersion: body.version, operations: [{ type: 'update_node', id: 'api', name: 'Too late' }] })
      expect(stale.status).toBe(409)
      client.provider.destroy()
    })

    it('answers 422 with the reason when an operation is refused, and changes nothing', async () => {
      const { body } = await read()
      const res = await edit({ baseVersion: body.version, operations: [{ type: 'remove_node', id: 'vps' }] })
      expect(res.status).toBe(422)
      expect(await res.json()).toEqual({ error: 'operation 1: "VPS-1" holds 2 elements; pass cascade: true to remove them with it' })
      expect((await read()).body.version).toBe(body.version)
    })

    it('has no suggestions for a canvas', async () => {
      const res = await edit({ mode: 'suggest', operations: [{ type: 'update_node', id: 'api', name: 'X' }] })
      expect(res.status).toBe(422)
      expect(await res.json()).toEqual({ error: 'an Architecture document has no suggestions; only a direct edit is possible' })
    })
  })
})
