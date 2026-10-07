import { describe, expect, it } from 'vitest'
import { diffCanvases, mergeForDiff } from './canvas-diff'
import type { ArchitectureJSON } from './canvas-model'

const node = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: 'system' as const,
  parentId: null,
  x: 0,
  y: 0,
  w: null,
  h: null,
  name: id,
  catalog: null,
  tags: [],
  description: '',
  repoUrl: null,
  links: [],
  ...over,
})
const before: ArchitectureJSON = {
  version: 1,
  nodes: [node('api'), node('db'), node('cache')],
  connections: [
    {
      id: 'c1',
      source: 'api',
      target: 'db',
      protocol: 'db-connection',
      label: '',
      port: null,
      links: [],
    },
  ],
}
const after: ArchitectureJSON = {
  version: 1,
  nodes: [
    node('api', { name: 'Order API' }),
    node('db', { x: 300 }),
    node('queue'),
  ],
  connections: [
    {
      id: 'c2',
      source: 'api',
      target: 'queue',
      protocol: 'publish',
      label: '',
      port: null,
      links: [],
    },
  ],
}

describe('the difference between two versions of a canvas', () => {
  it('names what was added, removed and changed; a move alone is not a change', () => {
    const diff = diffCanvases(before, after)
    expect(Object.fromEntries(diff)).toEqual({
      api: 'changed',
      cache: 'removed',
      queue: 'added',
      c1: 'removed',
      c2: 'added',
    })
  })

  it('draws the removed elements next to the newer canvas', () => {
    const merged = mergeForDiff(before, after)
    expect(merged.nodes.map((n) => n.id).sort()).toEqual([
      'api',
      'cache',
      'db',
      'queue',
    ])
    expect(merged.connections.map((c) => c.id).sort()).toEqual(['c1', 'c2'])
  })
})
