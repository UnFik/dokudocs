import { describe, expect, it } from 'vitest'
import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror'
import * as Y from 'yjs'
import { buildRebaseUpdate } from './collaboration-rebase-yjs'
import type { DocumentBodyNode } from './documentBody'
import {
  documentBodySchema,
  documentBodyToProseMirror,
  prosemirrorToDocumentBody,
} from './prosemirror/documentBody'

function node(
  nodeID: string,
  parentID: string | null,
  siblingOrder: number,
  type: string,
  content = ''
): DocumentBodyNode {
  return { nodeID, parentID, siblingOrder, type, content, attributes: {} }
}

const body = (): DocumentBodyNode[] => [
  node('root', null, 1, 'document'),
  node('p1', 'root', 1, 'paragraph'),
  node('r1', 'p1', 1, 'run', 'hello'),
  node('p2', 'root', 2, 'paragraph'),
  node('r2', 'p2', 1, 'run', 'second'),
]

function stateOf(nodes: DocumentBodyNode[]) {
  const doc = new Y.Doc()
  prosemirrorToYXmlFragment(
    documentBodyToProseMirror(nodes),
    doc.getXmlFragment('body')
  )
  return Y.encodeStateAsUpdate(doc)
}

function project(doc: Y.Doc) {
  return prosemirrorToDocumentBody(
    yXmlFragmentToProseMirrorRootNode(
      doc.getXmlFragment('body'),
      documentBodySchema
    )
  )
}

describe('buildRebaseUpdate', () => {
  it('turns a merged body into a minimal Yjs update on the canonical state', () => {
    const state = stateOf(body())
    const merged = body().map((n) =>
      n.nodeID === 'r1' ? { ...n, content: 'hello world' } : n
    )
    const update = buildRebaseUpdate(state, merged)

    const doc = new Y.Doc()
    Y.applyUpdate(doc, state)
    const root = doc.getXmlFragment('body').get(0) as Y.XmlElement
    const untouchedParagraph = root.get(1)
    Y.applyUpdate(doc, update)

    expect(project(doc).map((n) => [n.nodeID, n.content])).toEqual([
      ['root', ''],
      ['p1', ''],
      ['r1', 'hello world'],
      ['p2', ''],
      ['r2', 'second'],
    ])
    expect(root.get(1)).toBe(untouchedParagraph)
  })

  it('inserts a new inline node without recreating its siblings', () => {
    const state = stateOf(body())
    const merged = [...body(), node('r1b', 'p1', 2, 'run', ' there')]
    const doc = new Y.Doc()
    Y.applyUpdate(doc, state)
    const root = doc.getXmlFragment('body').get(0) as Y.XmlElement
    const paragraph = root.get(0) as Y.XmlElement
    const firstRun = paragraph.get(0)
    Y.applyUpdate(doc, buildRebaseUpdate(state, merged))

    expect(
      project(doc)
        .filter((n) => n.parentID === 'p1')
        .map((n) => n.nodeID)
    ).toEqual(['r1', 'r1b'])
    expect(paragraph.get(0)).toBe(firstRun)
  })
})
