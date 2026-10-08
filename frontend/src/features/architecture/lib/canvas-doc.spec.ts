import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  addConnection,
  addContainer,
  addSystem,
  applyPatches,
  createUndo,
  readCanvas,
  removeElement,
  updateConnection,
  updateNode,
} from './canvas-doc'
import { architectureToJSON } from './canvas-model'

const canvas = () => new Y.Doc()

describe('building a canvas', () => {
  it('adds Hosts and Systems that read back as the canvas JSON', () => {
    const doc = canvas()
    const vps = addContainer(doc, {
      kind: 'host',
      catalog: 'vps',
      name: 'VPS-1',
      x: 100,
      y: 100,
      w: 320,
      h: 206,
      parentId: null,
    })
    const api = addSystem(doc, {
      catalog: 'golang',
      name: 'Backend Order',
      x: 14,
      y: 32,
      parentId: vps,
    })
    const json = readCanvas(doc)
    expect(json.nodes.find((n) => n.id === vps)).toMatchObject({
      kind: 'host',
      catalog: 'vps',
      w: 320,
      h: 206,
    })
    expect(json.nodes.find((n) => n.id === api)).toMatchObject({
      kind: 'system',
      parentId: vps,
      x: 14,
      y: 32,
      name: 'Backend Order',
      tags: [],
      links: [],
    })
  })

  it('connects two Systems with a protocol', () => {
    const doc = canvas()
    const a = addSystem(doc, {
      catalog: 'react',
      name: 'Web',
      x: 0,
      y: 0,
      parentId: null,
    })
    const b = addSystem(doc, {
      catalog: 'golang',
      name: 'API',
      x: 300,
      y: 0,
      parentId: null,
    })
    const c = addConnection(doc, { source: a, target: b, protocol: 'rest' })
    expect(readCanvas(doc).connections).toEqual([
      {
        id: c,
        source: a,
        target: b,
        protocol: 'rest',
        label: '',
        port: null,
        links: [],
      },
    ])
    updateConnection(doc, c, { protocol: 'grpc', label: 'orders' })
    expect(readCanvas(doc).connections[0]).toMatchObject({
      protocol: 'grpc',
      label: 'orders',
    })
  })

  it('changes the fields of an element', () => {
    const doc = canvas()
    const a = addSystem(doc, {
      catalog: 'service',
      name: 'Acme Queue',
      x: 0,
      y: 0,
      parentId: null,
    })
    updateNode(doc, a, {
      catalog: 'rabbitmq',
      tags: ['amqp'],
      description: 'Order events',
      repoUrl: 'https://example.com/repo',
    })
    expect(readCanvas(doc).nodes[0]).toMatchObject({
      catalog: 'rabbitmq',
      tags: ['amqp'],
      description: 'Order events',
      repoUrl: 'https://example.com/repo',
      name: 'Acme Queue',
    })
  })

  it('moves and resizes several elements in one change', () => {
    const doc = canvas()
    const vps = addContainer(doc, {
      kind: 'host',
      catalog: 'vps',
      name: 'VPS',
      x: 0,
      y: 0,
      w: 200,
      h: 130,
      parentId: null,
    })
    const api = addSystem(doc, {
      catalog: 'golang',
      name: 'API',
      x: 400,
      y: 0,
      parentId: null,
    })
    let changes = 0
    doc.on('update', () => changes++)
    applyPatches(doc, [
      { id: api, parentId: vps, x: 14, y: 32 },
      { id: vps, w: 300 },
    ])
    expect(changes).toBe(1)
    const json = readCanvas(doc)
    expect(json.nodes.find((n) => n.id === api)).toMatchObject({
      parentId: vps,
      x: 14,
      y: 32,
    })
    expect(json.nodes.find((n) => n.id === vps)).toMatchObject({
      w: 300,
      h: 130,
    })
  })
})

describe('deleting', () => {
  it('removes a Host with everything inside it and their Connections, and counts the linked documents that stay', () => {
    const doc = canvas()
    const vps = addContainer(doc, {
      kind: 'host',
      catalog: 'vps',
      name: 'VPS',
      x: 0,
      y: 0,
      w: 320,
      h: 206,
      parentId: null,
    })
    const api = addSystem(doc, {
      catalog: 'golang',
      name: 'API',
      x: 14,
      y: 32,
      parentId: vps,
    })
    const db = addSystem(doc, {
      catalog: 'postgresql',
      name: 'DB',
      x: 400,
      y: 0,
      parentId: null,
    })
    updateNode(doc, api, { links: ['doc-1', 'doc-2'] })
    const c = addConnection(doc, {
      source: api,
      target: db,
      protocol: 'db-connection',
    })
    updateConnection(doc, c, { links: ['doc-2', 'doc-3'] })

    const removed = removeElement(doc, vps)
    expect(removed).toEqual({ nodes: 2, connections: 1, linkedDocuments: 3 })
    expect(readCanvas(doc).nodes.map((n) => n.id)).toEqual([db])
    expect(readCanvas(doc).connections).toEqual([])
  })

  it('removes just a Connection', () => {
    const doc = canvas()
    const a = addSystem(doc, {
      catalog: 'react',
      name: 'Web',
      x: 0,
      y: 0,
      parentId: null,
    })
    const b = addSystem(doc, {
      catalog: 'golang',
      name: 'API',
      x: 300,
      y: 0,
      parentId: null,
    })
    const c = addConnection(doc, { source: a, target: b, protocol: 'rest' })
    expect(removeElement(doc, c)).toEqual({
      nodes: 0,
      connections: 1,
      linkedDocuments: 0,
    })
    expect(readCanvas(doc).nodes).toHaveLength(2)
  })
})

describe('undo', () => {
  it('takes back one gesture of this editor and leaves other editors alone', () => {
    const doc = canvas()
    const undo = createUndo(doc)
    const a = addSystem(doc, {
      catalog: 'react',
      name: 'Web',
      x: 0,
      y: 0,
      parentId: null,
    })
    undo.stopCapturing()
    applyPatches(doc, [{ id: a, x: 50 }])
    applyPatches(doc, [{ id: a, x: 90 }])
    undo.stopCapturing()

    const remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc))
    const fromRemote = new Y.Doc()
    Y.applyUpdate(fromRemote, Y.encodeStateAsUpdate(remote))
    fromRemote.getMap<Y.Map<unknown>>('nodes').get(a)!.set('name', 'Web App')
    Y.applyUpdate(
      doc,
      Y.encodeStateAsUpdate(fromRemote, Y.encodeStateVector(doc))
    )

    undo.undo()
    expect(architectureToJSON(doc).nodes[0]).toMatchObject({
      x: 0,
      name: 'Web App',
    })
    undo.undo()
    expect(architectureToJSON(doc).nodes).toEqual([])
  })
})

describe('removing several elements at once', () => {
  it('removes them, with what they hold and their Connections, as one undo step', () => {
    const doc = canvas()
    const vps = addContainer(doc, {
      kind: 'host',
      catalog: 'vps',
      name: 'VPS',
      x: 0,
      y: 0,
      w: 320,
      h: 206,
      parentId: null,
    })
    const api = addSystem(doc, {
      catalog: 'golang',
      name: 'API',
      x: 14,
      y: 32,
      parentId: vps,
    })
    const cache = addSystem(doc, {
      catalog: 'redis',
      name: 'Cache',
      x: 400,
      y: 0,
      parentId: null,
    })
    const db = addSystem(doc, {
      catalog: 'postgresql',
      name: 'DB',
      x: 400,
      y: 200,
      parentId: null,
    })
    addConnection(doc, { source: api, target: cache, protocol: 'redis' })
    const undo = createUndo(doc)

    // API is named as well as its Host; it is counted once.
    expect(removeElement(doc, [vps, api, cache])).toEqual({
      nodes: 3,
      connections: 1,
      linkedDocuments: 0,
    })
    expect(readCanvas(doc).nodes.map((n) => n.id)).toEqual([db])

    undo.undo()
    expect(readCanvas(doc).nodes).toHaveLength(4)
    expect(readCanvas(doc).connections).toHaveLength(1)
  })
})
