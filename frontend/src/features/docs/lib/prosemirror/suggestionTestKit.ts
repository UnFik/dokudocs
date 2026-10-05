import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { documentBodySchema, prosemirrorToDocumentBody } from './documentBody'

// Builders for tests of suggestions: a document of paragraphs of runs, with the
// text of each run given as pieces that may carry a suggestion mark.

export const ME = '00000000-0000-4000-8000-0000000000a1'
export const OTHER = '00000000-0000-4000-8000-0000000000a2'

const nodes = documentBodySchema.nodes
const marks = documentBodySchema.marks

function attributes(nodeID: string, bodyAttributes: object = {}) {
  return {
    nodeID,
    bodyAttributes: JSON.stringify(bodyAttributes),
    bodyContent: '',
  }
}

/** One piece of run text: plain, bold, or under a suggestion by an author. */
export type Piece =
  | string
  | {
      text: string
      mark?: 'insert' | 'delete'
      by?: string
      id?: string
      bold?: boolean
    }

function suggestionMark(kind: 'insert' | 'delete', author: string, id: string) {
  return marks[`suggestion_${kind}`]!.create({ id, author })
}

export function run(nodeID: string, pieces: Piece[]) {
  return nodes.run!.create(
    attributes(nodeID),
    pieces.map((piece) => {
      const item = typeof piece === 'string' ? { text: piece } : piece
      const textMarks = []
      if (item.bold) textMarks.push(marks.strong!.create())
      if (item.mark)
        textMarks.push(
          suggestionMark(
            item.mark,
            item.by ?? ME,
            item.id ?? '00000000-0000-4000-8000-0000000000e1'
          )
        )
      return documentBodySchema.text(item.text, textMarks)
    })
  )
}

export function paragraph(nodeID: string, children: ProseMirrorNode[]) {
  return nodes.paragraph!.create(attributes(nodeID), children)
}

export function documentOf(...blocks: ProseMirrorNode[]) {
  return nodes.doc!.create(null, [
    nodes.document!.create(attributes('root'), blocks),
  ])
}

export function stateOf(doc: ProseMirrorNode) {
  return EditorState.create({ doc })
}

/** The document position of `offset` characters into the first run whose text contains `needle`. */
export function positionIn(doc: ProseMirrorNode, needle: string, offset = 0) {
  let found = -1
  doc.descendants((node, pos) => {
    if (found >= 0 || node.type.name !== 'run') return found < 0
    const index = node.textContent.indexOf(needle)
    if (index >= 0) found = pos + 1 + index + offset
    return false
  })
  if (found < 0) throw new Error(`no run contains ${needle}`)
  return found
}

/** What the canonical body says, as run texts in order. */
export function canonicalRuns(doc: ProseMirrorNode) {
  return prosemirrorToDocumentBody(doc)
    .filter((row) => row.type === 'run')
    .map((row) => row.content)
}

/** Every suggestion mark in the document: text, kind, author, id. */
export function suggestionsIn(doc: ProseMirrorNode) {
  const found: { text: string; kind: string; author: string; id: string }[] = []
  doc.descendants((node) => {
    if (!node.isText) return true
    for (const mark of node.marks)
      if (mark.type.name.startsWith('suggestion_'))
        found.push({
          text: node.text ?? '',
          kind: mark.type.name.slice('suggestion_'.length),
          author: mark.attrs.author,
          id: mark.attrs.id,
        })
    return false
  })
  return found
}
