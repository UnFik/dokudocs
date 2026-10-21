import { describe, expect, it } from 'vitest'
import { connectionsOf, focusOf, linkedElement } from './canvas-links'
import type {
  ArchitectureConnection,
  ArchitectureJSON,
  ArchitectureNode,
} from './canvas-model'

const node = (fields: Partial<ArchitectureNode> & { id: string }) =>
  ({
    kind: 'system',
    name: fields.id,
    catalog: null,
    x: 0,
    y: 0,
    w: null,
    h: null,
    parentId: null,
    tags: [],
    description: '',
    repoUrl: null,
    links: [],
    ...fields,
  }) satisfies ArchitectureNode

const connection = (
  id: string,
  source: string,
  target: string
): ArchitectureConnection => ({
  id,
  source,
  target,
  protocol: 'http',
  label: '',
  port: null,
  links: [],
})

// scim and console read from query; query reads events and writes to postgres; cache is alone.
const canvas: ArchitectureJSON = {
  version: 1,
  nodes: [
    node({ id: 'host', kind: 'host', w: 300, h: 200 }),
    node({ id: 'scim', parentId: 'host' }),
    node({ id: 'console', parentId: 'host' }),
    node({ id: 'query', parentId: 'host' }),
    node({ id: 'events', parentId: 'host' }),
    node({ id: 'pg' }),
    node({ id: 'cache' }),
  ],
  connections: [
    connection('c1', 'scim', 'query'),
    connection('c2', 'console', 'query'),
    connection('c3', 'query', 'events'),
    connection('c4', 'query', 'pg'),
    connection('c5', 'events', 'pg'),
  ],
}

describe('the Connections of a System', () => {
  it('lists incoming and outgoing Connections with the System at the other end', () => {
    expect(
      connectionsOf(canvas, 'query').map((c) => [
        c.connection.id,
        c.direction,
        c.other?.id,
      ])
    ).toEqual([
      ['c1', 'in', 'scim'],
      ['c2', 'in', 'console'],
      ['c3', 'out', 'events'],
      ['c4', 'out', 'pg'],
    ])
  })

  it('is empty for a System nothing connects to', () => {
    expect(connectionsOf(canvas, 'cache')).toEqual([])
  })
})

describe('what stands out for a selection', () => {
  it('is the selected System, its Connections and the Systems at their ends', () => {
    const focus = focusOf(canvas, [{ kind: 'node', id: 'query' }])!
    expect([...focus.nodes].sort()).toEqual([
      'console',
      'events',
      'pg',
      'query',
      'scim',
    ])
    expect([...focus.edges].sort()).toEqual(['c1', 'c2', 'c3', 'c4'])
  })

  it('leaves out Connections that only touch a neighbour', () => {
    const focus = focusOf(canvas, [{ kind: 'node', id: 'scim' }])!
    expect([...focus.edges]).toEqual(['c1'])
    expect(focus.nodes.has('events')).toBe(false)
  })

  it('is a lone System with no Connections still the focus', () => {
    const focus = focusOf(canvas, [{ kind: 'node', id: 'cache' }])!
    expect([...focus.nodes]).toEqual(['cache'])
    expect(focus.edges.size).toBe(0)
  })

  it('is nothing for no selection, several elements, a Connection, a Host or a Group', () => {
    expect(focusOf(canvas, [])).toBeNull()
    expect(
      focusOf(canvas, [
        { kind: 'node', id: 'query' },
        { kind: 'node', id: 'pg' },
      ])
    ).toBeNull()
    expect(focusOf(canvas, [{ kind: 'edge', id: 'c1' }])).toBeNull()
    expect(focusOf(canvas, [{ kind: 'node', id: 'host' }])).toBeNull()
  })
})

describe('the documents a selection links to', () => {
  const withLinks: ArchitectureJSON = {
    ...canvas,
    nodes: canvas.nodes.map((n) =>
      n.id === 'query' ? { ...n, links: ['d1', 'd2'] } : n
    ),
  }

  it('belong to one System or one Connection', () => {
    expect(
      linkedElement(withLinks, [{ kind: 'node', id: 'query' }])
    ).toMatchObject({ kind: 'system', title: 'query', links: ['d1', 'd2'] })
    expect(
      linkedElement(withLinks, [{ kind: 'edge', id: 'c1' }])
    ).toMatchObject({ kind: 'connection', title: 'scim → query', links: [] })
  })

  it('belong to nothing for no selection, several elements or a Host', () => {
    expect(linkedElement(withLinks, [])).toBeNull()
    expect(
      linkedElement(withLinks, [
        { kind: 'node', id: 'query' },
        { kind: 'edge', id: 'c1' },
      ])
    ).toBeNull()
    expect(linkedElement(withLinks, [{ kind: 'node', id: 'host' }])).toBeNull()
  })
})
