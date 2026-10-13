import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { applyArchitectureOperations } from '../src/agent-architecture'
import { AgentEditError } from '../src/agent-edit'
import { architectureLimits, architectureToJSON, seedArchitecture } from '../src/architecture'

const node = (id: string, kind: string, extra: Record<string, unknown> = {}) => ({
  id, kind, parentId: null, x: 0, y: 0, w: null, h: null, name: id, catalog: null, tags: [], description: '', repoUrl: null, links: [], ...extra,
})
const canvas = () => ({
  version: 1,
  nodes: [
    node('vps', 'host', { x: 40, y: 60, w: 400, h: 240, name: 'VPS-1', catalog: 'vps' }),
    node('edge', 'host', { x: 600, y: 60, w: 300, h: 200, name: 'Edge' }),
    node('api', 'system', { parentId: 'vps', x: 14, y: 32, name: 'API', catalog: 'golang' }),
    node('pg', 'system', { parentId: 'vps', x: 160, y: 32, name: 'PostgreSQL', catalog: 'postgresql' }),
  ],
  connections: [{ id: 'c1', source: 'api', target: 'pg', protocol: 'postgres', label: '', port: null, links: [] }],
})
const open = (json: object = canvas()) => {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, seedArchitecture(json))
  return doc
}
const read = (doc: Y.Doc) => architectureToJSON(doc)
const byName = (doc: Y.Doc, name: string) => read(doc).nodes.find((n) => n.name === name)!
const refusal = (doc: Y.Doc, ops: unknown) => {
  try {
    applyArchitectureOperations(doc, ops)
  } catch (error) {
    expect(error).toBeInstanceOf(AgentEditError)
    return (error as Error).message
  }
  throw new Error('expected the operations to be refused')
}

describe('adding nodes', () => {
  it('puts a System in a free place inside its Host and tells the Agent its id', () => {
    const doc = open()
    const result = applyArchitectureOperations(doc, [{ type: 'add_node', ref: 'cache', kind: 'system', name: 'Redis', catalog: 'redis', parent: 'vps' }])
    const redis = byName(doc, 'Redis')
    expect(result.created).toEqual({ cache: redis.id })
    expect(redis).toMatchObject({ kind: 'system', parentId: 'vps', catalog: 'redis' })
    const taken = ['api', 'pg'].map((id) => read(doc).nodes.find((n) => n.id === id)!)
    expect(taken.every((n) => n.x !== redis.x || n.y !== redis.y)).toBe(true)
  })

  it('grows the Host when its box is full', () => {
    const doc = open()
    const before = byName(doc, 'VPS-1')
    applyArchitectureOperations(doc, Array.from({ length: 6 }, (_, i) => ({ type: 'add_node', kind: 'system', name: `S${i}`, catalog: 'redis', parent: 'vps' })))
    const after = byName(doc, 'VPS-1')
    expect((after.w ?? 0) * (after.h ?? 0)).toBeGreaterThan((before.w ?? 0) * (before.h ?? 0))
  })

  it('lets a Connection in the same call use the ref of a node it adds', () => {
    const doc = open()
    applyArchitectureOperations(doc, [
      { type: 'add_node', ref: 'cache', kind: 'system', name: 'Redis', catalog: 'redis', parent: 'vps' },
      { type: 'add_connection', source: 'api', target: 'cache', protocol: 'redis' },
    ])
    const redis = byName(doc, 'Redis')
    expect(read(doc).connections.some((c) => c.source === 'api' && c.target === redis.id && c.protocol === 'redis')).toBe(true)
  })

  it('adds a Host or Group with the default size, and a top-level node clear of the others', () => {
    const doc = open()
    applyArchitectureOperations(doc, [
      { type: 'add_node', kind: 'host', name: 'Staging', catalog: 'vps' },
      { type: 'add_node', kind: 'group', name: 'Payments', parent: 'edge' },
    ])
    expect(byName(doc, 'Staging')).toMatchObject({ kind: 'host', parentId: null, w: 200, h: 130 })
    expect(byName(doc, 'Payments')).toMatchObject({ kind: 'group', parentId: 'edge', w: 220 })
    const staging = byName(doc, 'Staging')
    expect(staging.y).toBeGreaterThanOrEqual(300)
  })

  it('refuses what the editor would not allow, naming the operation', () => {
    const doc = open()
    expect(refusal(doc, [{ type: 'add_node', kind: 'system', name: 'X', parent: 'api' }])).toBe('operation 1: "API" is a System; only a Host or Group can hold other elements')
    expect(refusal(doc, [{ type: 'add_node', kind: 'system', name: 'X', parent: 'nope' }])).toBe('operation 1: there is no element "nope"')
    expect(refusal(doc, [{ type: 'add_node', kind: 'system', name: '' }])).toBe('operation 1: a node needs a name')
    expect(refusal(doc, [{ type: 'add_node', kind: 'database', name: 'X' }])).toBe('operation 1: kind must be host, system or group')
    expect(refusal(doc, [{ type: 'add_node', kind: 'system', name: 'X', w: 100 }])).toBe('operation 1: only a Host or Group has a size')
  })
})

describe('changing nodes', () => {
  it('updates the fields of a node', () => {
    const doc = open()
    applyArchitectureOperations(doc, [{ type: 'update_node', id: 'api', name: 'Order API', catalog: 'gin', tags: ['core'], description: 'Takes orders', repoUrl: 'https://example.com/r' }])
    expect(read(doc).nodes.find((n) => n.id === 'api')).toMatchObject({ name: 'Order API', catalog: 'gin', tags: ['core'], description: 'Takes orders', repoUrl: 'https://example.com/r' })
  })

  it('moves a System to another Host and lets the Host take it in', () => {
    const doc = open()
    applyArchitectureOperations(doc, [{ type: 'move_node', id: 'api', parent: 'edge' }])
    expect(read(doc).nodes.find((n) => n.id === 'api')!.parentId).toBe('edge')
  })

  it('takes a node out to the top level at the point it is given', () => {
    const doc = open()
    applyArchitectureOperations(doc, [{ type: 'move_node', id: 'api', parent: null, x: 700, y: 400 }])
    expect(read(doc).nodes.find((n) => n.id === 'api')).toMatchObject({ parentId: null, x: 700, y: 400 })
  })

  it('resizes a Host but not a System, and never moves a Host into itself', () => {
    const doc = open()
    applyArchitectureOperations(doc, [{ type: 'move_node', id: 'edge', w: 500, h: 320 }])
    expect(byName(doc, 'Edge')).toMatchObject({ w: 500, h: 320 })
    expect(refusal(doc, [{ type: 'move_node', id: 'api', w: 300 }])).toBe('operation 1: only a Host or Group has a size')
    expect(refusal(doc, [{ type: 'move_node', id: 'vps', parent: 'vps' }])).toBe('operation 1: "VPS-1" cannot be placed inside itself')
    const nested = open({ ...canvas(), nodes: [...canvas().nodes, node('inner', 'host', { parentId: 'vps', name: 'Inner', w: 150, h: 90 })] })
    expect(refusal(nested, [{ type: 'move_node', id: 'vps', parent: 'inner' }])).toBe('operation 1: "VPS-1" cannot be placed inside something it holds')
  })

  it('refuses an id that does not exist', () => {
    expect(refusal(open(), [{ type: 'update_node', id: 'zzz', name: 'X' }])).toBe('operation 1: there is no element "zzz"')
  })
})

describe('removing nodes', () => {
  it('removes a node with the Connections that touch it', () => {
    const doc = open()
    const result = applyArchitectureOperations(doc, [{ type: 'remove_node', id: 'pg' }])
    expect(read(doc).nodes.map((n) => n.id)).not.toContain('pg')
    expect(read(doc).connections).toEqual([])
    expect(result.removed).toEqual({ nodes: 1, connections: 1 })
  })

  it('refuses a Host that holds things unless the Agent says cascade', () => {
    const doc = open()
    expect(refusal(doc, [{ type: 'remove_node', id: 'vps' }])).toBe('operation 1: "VPS-1" holds 2 elements; pass cascade: true to remove them with it')
    const result = applyArchitectureOperations(doc, [{ type: 'remove_node', id: 'vps', cascade: true }])
    expect(read(doc).nodes.map((n) => n.id)).toEqual(['edge'])
    expect(result.removed).toEqual({ nodes: 3, connections: 1 })
  })
})

describe('connections', () => {
  it('adds, updates and removes a Connection between Systems', () => {
    const doc = open()
    applyArchitectureOperations(doc, [{ type: 'add_connection', ref: 'k', source: 'pg', target: 'api', protocol: 'rest', label: 'callback', port: '8080' }])
    const added = read(doc).connections.find((c) => c.label === 'callback')!
    expect(added).toMatchObject({ source: 'pg', target: 'api', protocol: 'rest', port: '8080' })
    applyArchitectureOperations(doc, [{ type: 'update_connection', id: added.id, protocol: 'grpc', label: 'push', port: null }])
    expect(read(doc).connections.find((c) => c.id === added.id)).toMatchObject({ protocol: 'grpc', label: 'push', port: null })
    applyArchitectureOperations(doc, [{ type: 'remove_connection', id: added.id }])
    expect(read(doc).connections.map((c) => c.id)).toEqual(['c1'])
  })

  it('only joins two different Systems', () => {
    const doc = open()
    expect(refusal(doc, [{ type: 'add_connection', source: 'vps', target: 'api', protocol: 'rest' }])).toBe('operation 1: "VPS-1" is a Host; a Connection joins two Systems')
    expect(refusal(doc, [{ type: 'add_connection', source: 'api', target: 'api', protocol: 'rest' }])).toBe('operation 1: a Connection cannot join a System to itself')
    expect(refusal(doc, [{ type: 'add_connection', source: 'api', target: 'zzz', protocol: 'rest' }])).toBe('operation 1: there is no element "zzz"')
    expect(refusal(doc, [{ type: 'add_connection', source: 'api', target: 'pg' }])).toBe('operation 1: a Connection needs a protocol')
  })
})

describe('document links', () => {
  const docId = '99999999-9999-4999-8999-999999999999'
  it('links a document to a node or a Connection, once, and unlinks it', () => {
    const doc = open()
    applyArchitectureOperations(doc, [
      { type: 'link_document', id: 'api', document_id: docId },
      { type: 'link_document', id: 'api', document_id: docId },
      { type: 'link_document', id: 'c1', document_id: docId },
    ])
    expect(read(doc).nodes.find((n) => n.id === 'api')!.links).toEqual([docId])
    expect(read(doc).connections[0]!.links).toEqual([docId])
    applyArchitectureOperations(doc, [{ type: 'unlink_document', id: 'api', document_id: docId }])
    expect(read(doc).nodes.find((n) => n.id === 'api')!.links).toEqual([])
  })
})

describe('the whole call', () => {
  it('applies nothing when one operation fails', () => {
    const doc = open()
    const before = JSON.stringify(read(doc))
    expect(refusal(doc, [
      { type: 'add_node', kind: 'system', name: 'Redis', catalog: 'redis', parent: 'vps' },
      { type: 'remove_node', id: 'zzz' },
    ])).toBe('operation 2: there is no element "zzz"')
    expect(JSON.stringify(read(doc))).toBe(before)
  })

  it('refuses an empty call, more than 50 operations, and an unknown type', () => {
    const doc = open()
    expect(refusal(doc, [])).toBe('there are no operations')
    expect(refusal(doc, Array.from({ length: 51 }, () => ({ type: 'update_node', id: 'api', name: 'x' })))).toBe('at most 50 operations at a time')
    expect(refusal(doc, [{ type: 'explode' }])).toBe('operation 1: unknown operation "explode"')
  })

  it('refuses to go past the limits of a document', () => {
    const full = { version: 1, nodes: Array.from({ length: architectureLimits.nodes }, (_, i) => node(`n${String(i).padStart(3, '0')}`, 'system')), connections: [] }
    expect(refusal(open(full), [{ type: 'add_node', kind: 'system', name: 'one more' }])).toBe(`operation 1: a document holds at most ${architectureLimits.nodes} nodes`)
  })
})
