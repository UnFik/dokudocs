import { describe, expect, it } from 'vitest'
import { rebasePendingEdits } from './collaboration-rebase'
import type { DocumentBodyNode } from './documentBody'

function node(
  nodeID: string,
  parentID: string | null,
  siblingOrder: number,
  type: string,
  content = ''
): DocumentBodyNode {
  return { nodeID, parentID, siblingOrder, type, content, attributes: {} }
}

// root -> p1 -> r1("hello"), root -> p2 -> r2("second")
const base = (): DocumentBodyNode[] => [
  node('root', null, 1, 'document'),
  node('p1', 'root', 1, 'paragraph'),
  node('r1', 'p1', 1, 'run', 'hello'),
  node('p2', 'root', 2, 'paragraph'),
  node('r2', 'p2', 1, 'run', 'second'),
]

function withContent(nodes: DocumentBodyNode[], id: string, content: string) {
  return nodes.map((n) => (n.nodeID === id ? { ...n, content } : n))
}

function without(nodes: DocumentBodyNode[], ...ids: string[]) {
  return nodes.filter((n) => !ids.includes(n.nodeID))
}

describe('rebasePendingEdits', () => {
  it('returns the canonical body untouched when there are no local edits', () => {
    const canonical = without(base(), 'p2', 'r2')
    const result = rebasePendingEdits({
      base: base(),
      local: base(),
      canonical,
    })
    expect(result.conflicts).toEqual([])
    expect(result.nodes).toEqual(canonical)
  })

  it('applies a local text edit onto a canonical body where an unrelated block was deleted', () => {
    const result = rebasePendingEdits({
      base: base(),
      local: withContent(base(), 'r1', 'hello world'),
      canonical: without(base(), 'p2', 'r2'),
    })
    expect(result.conflicts).toEqual([])
    expect(result.nodes.map((n) => [n.nodeID, n.content])).toEqual([
      ['root', ''],
      ['p1', ''],
      ['r1', 'hello world'],
    ])
  })

  it('reports a conflict, and drops nothing else, when the edited node was deleted remotely', () => {
    const canonical = without(base(), 'p1', 'r1')
    const result = rebasePendingEdits({
      base: base(),
      local: withContent(base(), 'r1', 'hello world'),
      canonical,
    })
    expect(result.conflicts).toEqual([{ nodeID: 'r1', reason: 'node-deleted' }])
    expect(result.nodes).toEqual(canonical)
  })

  it('inserts a locally created node after its previous sibling', () => {
    const local = [...base(), node('r1b', 'p1', 2, 'run', ' there')]
    const result = rebasePendingEdits({
      base: base(),
      local,
      canonical: without(base(), 'p2', 'r2'),
    })
    expect(result.conflicts).toEqual([])
    expect(
      result.nodes
        .filter((n) => n.parentID === 'p1')
        .sort((a, b) => a.siblingOrder - b.siblingOrder)
        .map((n) => [n.nodeID, n.siblingOrder])
    ).toEqual([
      ['r1', 1],
      ['r1b', 2],
    ])
  })

  it('reports a conflict when a locally created node lives under a remotely deleted parent', () => {
    const local = [...base(), node('r2b', 'p2', 2, 'run', ' more')]
    const canonical = without(base(), 'p2', 'r2')
    const result = rebasePendingEdits({ base: base(), local, canonical })
    expect(result.conflicts).toEqual([
      { nodeID: 'r2b', reason: 'parent-deleted' },
    ])
    expect(result.nodes).toEqual(canonical)
  })

  it('merges non-overlapping edits to the same text node', () => {
    const b = withContent(base(), 'r1', 'one two three')
    const result = rebasePendingEdits({
      base: b,
      local: withContent(b, 'r1', 'ONE two three'),
      canonical: withContent(b, 'r1', 'one two THREE'),
    })
    expect(result.conflicts).toEqual([])
    expect(result.nodes.find((n) => n.nodeID === 'r1')?.content).toBe(
      'ONE two THREE'
    )
  })

  it('reports a conflict when both sides edit the same region', () => {
    const b = withContent(base(), 'r1', 'one two three')
    const canonical = withContent(b, 'r1', 'one 2 three')
    const result = rebasePendingEdits({
      base: b,
      local: withContent(b, 'r1', 'one TWO three'),
      canonical,
    })
    expect(result.conflicts).toEqual([
      { nodeID: 'r1', reason: 'concurrent-edit' },
    ])
    expect(result.nodes).toEqual(canonical)
  })

  it('does not duplicate a node that canonical already contains', () => {
    const shared = node('r1b', 'p1', 2, 'run', ' there')
    const result = rebasePendingEdits({
      base: base(),
      local: [...base(), shared],
      canonical: [...base(), shared],
    })
    expect(result.conflicts).toEqual([])
    expect(result.nodes.filter((n) => n.nodeID === 'r1b')).toHaveLength(1)
  })
  it('applies clean edits and holds only the conflicting node when both kinds exist', () => {
    const b = base()
    const local = withContent(withContent(b, 'r1', 'hello world'), 'r2', 'mine')
    const canonical = withContent(b, 'r2', 'theirs')
    const result = rebasePendingEdits({ base: b, local, canonical })
    expect(result.conflicts).toEqual([
      { nodeID: 'r2', reason: 'concurrent-edit' },
    ])
    expect(result.applied).toBe(1)
    expect(result.nodes.find((n) => n.nodeID === 'r1')?.content).toBe(
      'hello world'
    )
    expect(result.nodes.find((n) => n.nodeID === 'r2')?.content).toBe('theirs')
    expect(result.held).toEqual([
      {
        nodeID: 'r2',
        reason: 'concurrent-edit',
        local: local.find((n) => n.nodeID === 'r2'),
        canonical: canonical.find((n) => n.nodeID === 'r2') ?? null,
      },
    ])
  })

  it('reports zero applied edits when everything conflicts', () => {
    const canonical = without(base(), 'p1', 'r1')
    const result = rebasePendingEdits({
      base: base(),
      local: withContent(base(), 'r1', 'x'),
      canonical,
    })
    expect(result.applied).toBe(0)
    expect(result.held[0]?.canonical).toBeNull()
  })
})
