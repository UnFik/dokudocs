import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { EditorState, Transaction } from 'prosemirror-state'
import { documentBodySchema } from './documentBody'

const inlineParentNames = new Set([
  'paragraph',
  'atx_heading',
  'setext_heading',
  'table_cell',
])

/**
 * Normalize one local transaction before it reaches the Yjs binding. Deleting
 * and moving blocks are ordinary edits: the editor is the only writer.
 */
export function prepareBodyTransaction(
  state: EditorState,
  transaction: Transaction
): Transaction {
  if (!transaction.docChanged) return transaction

  keepDocumentIdentity(state, transaction)
  wrapRawInlineText(transaction)
  splitRunsWithMixedMarks(transaction)
  assignNodeIDs(transaction)
  transaction.doc.check()
  return transaction
}

// Select-all then Delete (or typing) replaces the whole document node with a
// fresh one that has no node ID, which would read as deleting the root. The
// root is never replaced: only what it contains changes.
function keepDocumentIdentity(state: EditorState, transaction: Transaction) {
  const previous = state.doc.firstChild
  const next = transaction.doc.firstChild
  if (
    !previous ||
    !next ||
    transaction.doc.childCount !== 1 ||
    previous.attrs.nodeID === next.attrs.nodeID
  )
    return
  transaction.setNodeMarkup(0, undefined, previous.attrs)
}

function wrapRawInlineText(transaction: Transaction) {
  const parents: { node: ProseMirrorNode; position: number }[] = []
  transaction.doc.descendants((node, position) => {
    if (!inlineParentNames.has(node.type.name)) return true
    const children = Array.from({ length: node.childCount }, (_, i) =>
      node.child(i)
    )
    const hasRawText = children.some((child) => child.isText)
    if (
      hasRawText &&
      (children.some((child) => !child.isText) ||
        children.some((child) => child.isText && child.marks.length > 0))
    )
      parents.push({ node, position })
    return true
  })

  for (const { node, position } of parents.reverse()) {
    const replacements: ProseMirrorNode[] = []
    for (let i = 0; i < node.childCount; ) {
      const child = node.child(i)
      if (!child.isText) {
        replacements.push(child)
        i++
        continue
      }
      const text = [child]
      i++
      while (i < node.childCount) {
        const next = node.child(i)
        if (!next.isText || !sameMarks(child.marks, next.marks)) break
        text.push(next)
        i++
      }
      replacements.push(
        documentBodySchema.nodes.run!.create(
          { nodeID: null, bodyAttributes: '{}', bodyContent: '' },
          text
        )
      )
    }
    transaction.replaceWith(
      position + 1,
      position + node.nodeSize - 1,
      replacements
    )
  }
}

function splitRunsWithMixedMarks(transaction: Transaction) {
  const mixedRuns: { node: ProseMirrorNode; position: number }[] = []
  transaction.doc.descendants((node, position) => {
    if (node.type === documentBodySchema.nodes.run) {
      if (!hasUniformMarks(node)) mixedRuns.push({ node, position })
      return false
    }
    return true
  })

  // Split in place so the selection maps through the edit instead of
  // collapsing; the first part keeps the run ID and assignNodeIDs issues the rest.
  for (const { node, position } of mixedRuns.reverse()) {
    const boundaries: number[] = []
    let offset = 0
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (i > 0 && !sameMarks(node.child(i - 1).marks, child.marks))
        boundaries.push(position + 1 + offset)
      offset += child.nodeSize
    }
    for (const boundary of boundaries.reverse()) transaction.split(boundary)
  }
}

function hasUniformMarks(node: ProseMirrorNode) {
  if (node.childCount < 2) return true
  const marks = node.child(0).marks
  for (let i = 1; i < node.childCount; i++)
    if (!sameMarks(marks, node.child(i).marks)) return false
  return true
}

// A suggestion is not formatting: a run keeps its identity whether or not part of
// its text is proposed, deleted, or restyled by one.
function formattingMarks(marks: ProseMirrorNode['marks']) {
  return marks.filter((mark) => !mark.type.name.startsWith('suggestion_'))
}

function sameMarks(
  left: ProseMirrorNode['marks'],
  right: ProseMirrorNode['marks']
) {
  const leftFormatting = formattingMarks(left)
  const rightFormatting = formattingMarks(right)
  return (
    leftFormatting.length === rightFormatting.length &&
    leftFormatting.every((mark, index) => mark.eq(rightFormatting[index]!))
  )
}

function assignNodeIDs(transaction: Transaction) {
  const seen = new Set<string>()
  const missingOrDuplicate: number[] = []
  transaction.doc.descendants((node, position) => {
    if (node.isText) return true
    const nodeID = node.attrs.nodeID
    if (typeof nodeID !== 'string' || !nodeID || seen.has(nodeID))
      missingOrDuplicate.push(position)
    else seen.add(nodeID)
    return true
  })

  for (const position of missingOrDuplicate.reverse()) {
    const node = transaction.doc.nodeAt(position)
    if (!node) throw new Error('cannot assign an ID to a missing node')
    let nodeID = crypto.randomUUID()
    while (seen.has(nodeID)) nodeID = crypto.randomUUID()
    seen.add(nodeID)
    transaction.setNodeMarkup(position, undefined, { ...node.attrs, nodeID })
  }
}
