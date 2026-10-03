import { Fragment } from 'prosemirror-model'
import {
  TextSelection,
  type EditorState,
  type Transaction,
} from 'prosemirror-state'
import { nodeSuggestionOf } from './nodeSuggestion'

// Backspace at the start of a paragraph, or Delete at the end of the one before
// it, in Edit mode. ProseMirror would move the runs up and drop the paragraph in
// one step, which is a move plus a delete: not something one command can send.
// So it is done as two: the text is copied to the end of the first paragraph as
// an ordinary edit, then the second paragraph is deleted with DeleteNode.

export type ParagraphJoin = {
  /** The ordinary edit: the second paragraph's text added to the first. */
  transaction: Transaction | null
  /** The paragraph DeleteNode removes afterwards. */
  deleteNodeID: string
}

/** `upper` is the position before the first paragraph, as `joinTarget` gives it. */
export function joinParagraphs(
  state: EditorState,
  upper: number
): ParagraphJoin | null {
  const doc = state.doc
  const first = doc.nodeAt(upper)
  const secondPos = first ? upper + first.nodeSize : -1
  const second = secondPos >= 0 ? doc.nodeAt(secondPos) : null
  const container = doc.resolve(upper).parent.type.name
  if (
    !first ||
    !second ||
    (container !== 'document' && container !== 'block_quote') ||
    first.type.name !== 'paragraph' ||
    second.type.name !== 'paragraph' ||
    nodeSuggestionOf(first) ||
    nodeSuggestionOf(second) ||
    typeof second.attrs.nodeID !== 'string'
  )
    return null
  let plain = true
  second.descendants((node) => {
    if (node.marks.some((mark) => mark.type.name.startsWith('suggestion_')))
      plain = false
    return plain
  })
  if (!plain) return null

  const runs: ReturnType<typeof second.copy>[] = []
  second.forEach((child) => {
    if (child.type.name !== 'run') plain = false
    else if (child.content.size)
      runs.push(
        child.type.create(
          { ...child.attrs, nodeID: crypto.randomUUID() },
          child.content,
          child.marks
        )
      )
  })
  if (!plain) return null

  const deleteNodeID = second.attrs.nodeID as string
  if (!runs.length) return { transaction: null, deleteNodeID }
  const joinAt = upper + first.nodeSize - 1
  const tr = state.tr.insert(joinAt, Fragment.from(runs))
  tr.setSelection(TextSelection.create(tr.doc, joinAt))
  return { transaction: tr, deleteNodeID }
}
