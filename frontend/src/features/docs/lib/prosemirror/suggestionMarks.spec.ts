import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import {
  prosemirrorToYDoc,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror'
import * as Y from 'yjs'
import { documentBodySchema, prosemirrorToDocumentBody } from './documentBody'
import { prepareBodyTransaction } from './prepareBodyTransaction'
import { fixtureCanonicalRows, suggestionFixtureDoc } from './suggestionFixture'

// A suggestion is content of the body, but not part of the canonical body: what
// prosemirrorToDocumentBody returns is the body as if every suggestion were
// rejected, the same view the server's projection gives (ADR 0027).

const AUTHOR = '00000000-0000-4000-8000-0000000000a1'
const SUGGESTION = '00000000-0000-4000-8000-0000000000b1'
const nodes = documentBodySchema.nodes
const marks = documentBodySchema.marks

function attrs(nodeID: string, bodyAttributes: object = {}) {
  return {
    nodeID,
    bodyAttributes: JSON.stringify(bodyAttributes),
    bodyContent: '',
  }
}

type Piece = [text: string, markName?: string]

function run(id: string, pieces: Piece[]) {
  return nodes.run!.create(
    attrs(id),
    pieces.map(([text, markName]) =>
      documentBodySchema.text(
        text,
        markName
          ? [marks[markName]!.create({ id: SUGGESTION, author: AUTHOR })]
          : undefined
      )
    )
  )
}

function paragraph(id: string, children: ProseMirrorNode[], body = {}) {
  return nodes.paragraph!.create(attrs(id, body), children)
}

function documentOf(...blocks: ProseMirrorNode[]) {
  return nodes.doc!.create(null, [
    nodes.document!.create(attrs('root'), blocks),
  ])
}

const suggestionOf = (kind: string) => ({
  suggestion: { kind, id: SUGGESTION, author: AUTHOR },
})

describe('suggestions in the body, seen as the canonical body', () => {
  it('drops inserted text from a run and keeps the run', () => {
    const doc = documentOf(
      paragraph('p1', [
        run('r1', [['Hello '], ['big ', 'suggestion_insert'], ['world']]),
      ])
    )

    const rows = prosemirrorToDocumentBody(doc)

    expect(rows.map((row) => row.nodeID)).toEqual(['root', 'p1', 'r1'])
    expect(rows[2]).toMatchObject({ content: 'Hello world', attributes: {} })
  })

  it('drops a run that is only inserted text and keeps sibling order contiguous', () => {
    const doc = documentOf(
      paragraph('p1', [
        run('r1', [['before']]),
        run('r2', [[' typed', 'suggestion_insert']]),
        run('r3', [[' after']]),
      ])
    )

    const rows = prosemirrorToDocumentBody(doc)

    expect(rows.map((row) => row.nodeID)).toEqual(['root', 'p1', 'r1', 'r3'])
    expect(
      rows.filter((row) => row.type === 'run').map((row) => row.siblingOrder)
    ).toEqual([0, 1])
  })

  it('keeps text under a delete or a format suggestion exactly as it is', () => {
    const doc = documentOf(
      paragraph('p1', [
        run('r1', [
          ['Keep '],
          ['drop', 'suggestion_delete'],
          [' and '],
          ['restyle', 'suggestion_format'],
        ]),
      ])
    )

    const rows = prosemirrorToDocumentBody(doc)

    expect(rows[2]).toMatchObject({
      content: 'Keep drop and restyle',
      attributes: {},
    })
  })

  it('drops a block inserted by a suggestion with everything under it', () => {
    const doc = documentOf(
      paragraph('p1', [run('r1', [['canonical']])]),
      paragraph(
        'p2',
        [run('r2', [['inserted block']])],
        suggestionOf('insert')
      ),
      paragraph('p3', [run('r3', [['last']])])
    )

    const rows = prosemirrorToDocumentBody(doc)

    expect(rows.map((row) => row.nodeID)).toEqual([
      'root',
      'p1',
      'r1',
      'p3',
      'r3',
    ])
    expect(
      rows
        .filter((row) => row.type === 'paragraph')
        .map((row) => row.siblingOrder)
    ).toEqual([0, 1])
  })

  it('keeps a block under a delete or a format suggestion without the suggestion in its attributes', () => {
    const doc = documentOf(
      paragraph('p1', [run('r1', [['one']])], suggestionOf('delete')),
      paragraph('p2', [run('r2', [['two']])], {
        suggestion: {
          ...suggestionOf('format').suggestion,
          toType: 'atx-heading',
        },
      })
    )

    const rows = prosemirrorToDocumentBody(doc)

    expect(rows.map((row) => row.nodeID)).toEqual([
      'root',
      'p1',
      'r1',
      'p2',
      'r2',
    ])
    expect(
      rows
        .filter((row) => row.type === 'paragraph')
        .map((row) => row.attributes)
    ).toEqual([{}, {}])
  })

  it('does not split a run because of where its suggestions start and end', () => {
    const doc = documentOf(
      paragraph('p1', [
        run('r1', [['Hello '], ['big ', 'suggestion_insert'], ['world']]),
      ]),
      paragraph('p2', [run('r2', [['x']])])
    )
    const state = EditorState.create({ doc })
    // Any ordinary edit goes through prepareBodyTransaction, which splits runs
    // whose formatting changes; a suggestion is not formatting.
    const transaction = state.tr.insertText('!', doc.content.size - 3)

    const prepared = prepareBodyTransaction(state, transaction)

    const runs: string[] = []
    prepared.doc.descendants((node) => {
      if (node.type.name === 'run') runs.push(node.attrs.nodeID)
    })
    expect(runs).toEqual(['r1', 'r2'])
  })

  it('survives a round trip through Yjs with every suggestion intact', () => {
    const doc = suggestionFixtureDoc()
    const ydoc = prosemirrorToYDoc(doc, 'body')
    // What another client receives: the encoded state, applied to a fresh doc.
    const received = new Y.Doc()
    Y.applyUpdate(received, Y.encodeStateAsUpdate(ydoc))

    const back = yXmlFragmentToProseMirrorRootNode(
      received.getXmlFragment('body'),
      documentBodySchema
    )

    expect(back.eq(doc)).toBe(true)
  })

  it('projects the fixture to the canonical body the backend expects', () => {
    const rows = prosemirrorToDocumentBody(suggestionFixtureDoc())

    expect(
      rows.map(({ nodeID, type, content }) => ({ nodeID, type, content }))
    ).toEqual(fixtureCanonicalRows)
  })
})
