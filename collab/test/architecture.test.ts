import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  architectureSummary,
  architectureToJSON,
  linkedDocuments,
  seedArchitecture,
  type ArchitectureJSON,
} from '../src/architecture'

const node = (id: string, over: Partial<ArchitectureJSON['nodes'][number]> = {}) => ({
  id, kind: 'system' as const, parentId: null, x: 0, y: 0, w: null, h: null, name: id, catalog: null,
  tags: [], description: '', repoUrl: null, links: [], ...over,
})

function sample(): ArchitectureJSON {
  return {
    version: 1,
    nodes: [
      node('vps', { kind: 'host', name: 'VPS-1', catalog: 'vps', w: 320, h: 200 }),
      node('order', { name: 'Backend Order', catalog: 'golang', tags: ['gin'], parentId: 'vps', links: ['doc-1', 'doc-2', 'doc-1'] }),
      node('pg', { name: 'PostgreSQL', catalog: 'postgresql' }),
    ],
    connections: [{ id: 'c1', source: 'order', target: 'pg', protocol: 'db-connection', label: '', port: '5432', links: ['doc-3'] }],
  }
}

const load = (state: Uint8Array) => {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, state)
  return doc
}

// A restore rebuilds the state from JSON; a device that kept the earlier copy
// must not end up with every element twice (ADR 0029, same rule as Markdown).
describe('building an Architecture document from its JSON', () => {
  it('gives the same state every time, whatever order the JSON lists elements in', () => {
    const shuffled = { ...sample(), nodes: [...sample().nodes].reverse() }
    expect(seedArchitecture(sample())).toEqual(seedArchitecture(shuffled))
  })

  it('reads back as the JSON it was built from, sorted by id', () => {
    const json = architectureToJSON(load(seedArchitecture(sample())))
    expect(json.nodes.map((n) => n.id)).toEqual(['order', 'pg', 'vps'])
    expect(json.nodes.find((n) => n.id === 'order')).toMatchObject({ parentId: 'vps', tags: ['gin'], catalog: 'golang' })
    expect(json.connections[0]).toMatchObject({ source: 'order', target: 'pg', port: '5432' })
  })

  it('does not double anything when two rebuilt copies meet', () => {
    const left = load(seedArchitecture(sample()))
    const right = load(seedArchitecture(sample()))
    Y.applyUpdate(left, Y.encodeStateAsUpdate(right))
    expect(architectureToJSON(left)).toEqual(architectureToJSON(load(seedArchitecture(sample()))))
  })

  it('keeps both edits when two people change different fields of one element', () => {
    const left = load(seedArchitecture(sample()))
    const right = load(seedArchitecture(sample()))
    left.getMap<Y.Map<unknown>>('nodes').get('order')!.set('name', 'Order API')
    right.getMap<Y.Map<unknown>>('nodes').get('order')!.set('x', 240)
    Y.applyUpdate(left, Y.encodeStateAsUpdate(right))
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left))
    const order = architectureToJSON(left).nodes.find((n) => n.id === 'order')!
    expect(order).toMatchObject({ name: 'Order API', x: 240 })
    expect(architectureToJSON(right)).toEqual(architectureToJSON(left))
  })
})

describe('reading a state an editor wrote badly', () => {
  it('drops a connection whose end is gone and a parent that no longer exists', () => {
    const doc = load(seedArchitecture(sample()))
    doc.getMap('nodes').delete('vps')
    doc.getMap('nodes').delete('pg')
    const json = architectureToJSON(doc)
    expect(json.connections).toEqual([])
    expect(json.nodes[0]).toMatchObject({ id: 'order', parentId: null })
  })

  it('reads wrong field types as defaults instead of failing', () => {
    const doc = new Y.Doc()
    const m = new Y.Map<unknown>()
    doc.getMap('nodes').set('n', m)
    m.set('x', 'left')
    m.set('kind', 'planet')
    expect(architectureToJSON(doc).nodes[0]).toMatchObject({ x: 0, kind: 'system', name: '', tags: [] })
  })
})

describe('what is derived for search and links', () => {
  it('writes one line per element, naming where a System runs', () => {
    const text = architectureSummary(sample())
    expect(text).toContain('System "Backend Order" (golang; gin) runs on Host "VPS-1".')
    expect(text).toContain('"Backend Order" calls "PostgreSQL" over db-connection.')
  })

  it('lists each linked document once per element', () => {
    expect(linkedDocuments(sample())).toEqual([
      { elementID: 'order', elementKind: 'system', documentID: 'doc-1' },
      { elementID: 'order', elementKind: 'system', documentID: 'doc-2' },
      { elementID: 'c1', elementKind: 'connection', documentID: 'doc-3' },
    ])
  })
})

describe('telling whether an update can add an element', async () => {
  const { mayAddElements } = await import('../src/permissions')
  const editOn = (doc: Y.Doc, change: (d: Y.Doc) => void) => {
    const probe = new Y.Doc()
    probe.clientID = 77
    Y.applyUpdate(probe, Y.encodeStateAsUpdate(doc))
    const before = Y.encodeStateVector(probe)
    change(probe)
    return Y.encodeStateAsUpdate(probe, before)
  }

  it('says no for moving or renaming, so the full check is skipped', () => {
    const doc = load(seedArchitecture(sample()))
    const move = editOn(doc, (d) => (d.getMap<Y.Map<unknown>>('nodes').get('order')!).set('x', 400))
    const tag = editOn(doc, (d) => ((d.getMap<Y.Map<unknown>>('nodes').get('order')!).get('tags') as Y.Array<string>).push(['gorm']))
    expect(mayAddElements(doc, move)).toBe(false)
    expect(mayAddElements(doc, tag)).toBe(false)
  })

  it('says yes for a new element and for an element written again under an old id', () => {
    const doc = load(seedArchitecture(sample()))
    expect(mayAddElements(doc, editOn(doc, (d) => d.getMap('nodes').set('new', new Y.Map())))).toBe(true)
    expect(mayAddElements(doc, editOn(doc, (d) => d.getMap('connections').set('c2', new Y.Map())))).toBe(true)
    doc.getMap('nodes').delete('pg')
    expect(mayAddElements(doc, editOn(doc, (d) => d.getMap('nodes').set('pg', new Y.Map())))).toBe(true)
  })
})
