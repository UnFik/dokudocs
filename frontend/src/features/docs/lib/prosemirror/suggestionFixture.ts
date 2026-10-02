import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { documentBodySchema } from './documentBody'

// One body that has every kind of suggestion in it. The frontend and the backend
// both project it and must agree on the canonical body, so the backend reads a
// Yjs encoding of this document (generate-suggestions-fixture.ts writes it).

const fixtureIDs = {
  root: '10000000-0000-4000-8000-000000000001',
  p1: '10000000-0000-4000-8000-000000000011',
  r1: '10000000-0000-4000-8000-000000000012',
  p2: '10000000-0000-4000-8000-000000000021',
  r2: '10000000-0000-4000-8000-000000000022',
  p3: '10000000-0000-4000-8000-000000000031',
  r3: '10000000-0000-4000-8000-000000000032',
  p4: '10000000-0000-4000-8000-000000000041',
  r4: '10000000-0000-4000-8000-000000000042',
  author: '20000000-0000-4000-8000-000000000001',
  insert: '30000000-0000-4000-8000-000000000001',
  delete: '30000000-0000-4000-8000-000000000002',
  format: '30000000-0000-4000-8000-000000000003',
  block: '30000000-0000-4000-8000-000000000004',
  blockDelete: '30000000-0000-4000-8000-000000000005',
}

/** The canonical body of the fixture: node IDs in order, and the text of each run. */
export const fixtureCanonicalRows = [
  { nodeID: fixtureIDs.root, type: 'document', content: '' },
  { nodeID: fixtureIDs.p1, type: 'paragraph', content: '' },
  { nodeID: fixtureIDs.r1, type: 'run', content: 'Hello world' },
  { nodeID: fixtureIDs.p2, type: 'paragraph', content: '' },
  { nodeID: fixtureIDs.r2, type: 'run', content: 'Keep drop and restyle' },
  { nodeID: fixtureIDs.p4, type: 'paragraph', content: '' },
  { nodeID: fixtureIDs.r4, type: 'run', content: 'block to delete' },
]

const nodes = documentBodySchema.nodes
const marks = documentBodySchema.marks

function attributes(nodeID: string, bodyAttributes: object = {}) {
  return {
    nodeID,
    bodyAttributes: JSON.stringify(bodyAttributes),
    bodyContent: '',
  }
}

function mark(name: string, id: string, extra: object = {}) {
  return marks[name]!.create({ id, author: fixtureIDs.author, ...extra })
}

function run(
  nodeID: string,
  pieces: [string, ProseMirrorNode['marks'][number]?][]
) {
  return nodes.run!.create(
    attributes(nodeID),
    pieces.map(([text, textMark]) =>
      documentBodySchema.text(text, textMark ? [textMark] : undefined)
    )
  )
}

export function suggestionFixtureDoc(): ProseMirrorNode {
  const blockSuggestion = (kind: string, id: string, extra: object = {}) => ({
    suggestion: { kind, id, author: fixtureIDs.author, ...extra },
  })
  return nodes.doc!.create(null, [
    nodes.document!.create(attributes(fixtureIDs.root), [
      // Text typed into the middle of a run: an insertion.
      nodes.paragraph!.create(attributes(fixtureIDs.p1), [
        run(fixtureIDs.r1, [
          ['Hello '],
          ['big ', mark('suggestion_insert', fixtureIDs.insert)],
          ['world'],
        ]),
      ]),
      // Text proposed for deletion and text proposed to be restyled.
      nodes.paragraph!.create(attributes(fixtureIDs.p2), [
        run(fixtureIDs.r2, [
          ['Keep '],
          ['drop', mark('suggestion_delete', fixtureIDs.delete)],
          [' and '],
          [
            'restyle',
            mark('suggestion_format', fixtureIDs.format, {
              set: { bold: true },
            }),
          ],
        ]),
      ]),
      // A whole block that is proposed: not canonical, with its run.
      nodes.paragraph!.create(
        attributes(fixtureIDs.p3, blockSuggestion('insert', fixtureIDs.block)),
        [run(fixtureIDs.r3, [['inserted block']])]
      ),
      // A block proposed for deletion: still canonical.
      nodes.paragraph!.create(
        attributes(
          fixtureIDs.p4,
          blockSuggestion('delete', fixtureIDs.blockDelete)
        ),
        [run(fixtureIDs.r4, [['block to delete']])]
      ),
    ]),
  ])
}
