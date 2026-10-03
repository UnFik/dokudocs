import { Fragment, type Node as ProseMirrorNode } from 'prosemirror-model'
import {
  TextSelection,
  type EditorState,
  type Transaction,
} from 'prosemirror-state'
import { nodeSuggestionOf } from './nodeSuggestion'

// Backspace at the start of a line, or Delete at the end of the one before it,
// in Edit mode. ProseMirror would move the runs up and drop the block in one
// step, which is a move plus a delete: not something one command can send. So it
// is done as two: the text is copied to the end of the upper line as an ordinary
// edit, then the lower block is deleted with DeleteNode. The upper line keeps
// its own kind, as in Google Docs: a paragraph under a heading becomes part of
// the heading, a heading under a paragraph becomes part of the paragraph.

export type ParagraphJoin = {
  /** The ordinary edit: the lower line's text added to the upper one. */
  transaction: Transaction | null
  /** The block DeleteNode removes afterwards. */
  deleteNodeID: string
}

const joinable = new Set(['paragraph', 'atx_heading'])
const items = new Set(['list_item', 'task_list_item'])
const wrappers = new Set([
  'bullet_list',
  'order_list',
  'task_list',
  'list_item',
  'task_list_item',
  'block_quote',
])

/** The position at the end of the text of the last line inside `node`, which starts at `pos`. */
function endOfLastLine(node: ProseMirrorNode, pos: number): number | null {
  let current = node
  let at = pos
  while (!current.isTextblock) {
    if (!wrappers.has(current.type.name)) return null
    const child = current.lastChild
    if (!child) return null
    at = at + current.nodeSize - 1 - child.nodeSize
    current = child
  }
  return joinable.has(current.type.name) ? at + current.nodeSize - 1 : null
}

function plainRuns(block: ProseMirrorNode) {
  let plain = true
  block.descendants((node) => {
    if (node.marks.some((mark) => mark.type.name.startsWith('suggestion_')))
      plain = false
    return plain
  })
  if (!plain) return null
  const runs: ProseMirrorNode[] = []
  block.forEach((child) => {
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
  return plain ? runs : null
}

/** `upper` is the position before the first block, as `joinTarget` gives it. */
export function joinParagraphs(
  state: EditorState,
  upper: number
): ParagraphJoin | null {
  const doc = state.doc
  const first = doc.nodeAt(upper)
  const secondPos = first ? upper + first.nodeSize : -1
  const second = secondPos >= 0 ? doc.nodeAt(secondPos) : null
  if (!first || !second || typeof second.attrs.nodeID !== 'string') return null
  const container = doc.resolve(upper).parent.type.name
  const sameKind =
    (container === 'document' ||
      container === 'block_quote' ||
      container === 'bullet_list' ||
      container === 'order_list' ||
      container === 'task_list') &&
    (joinable.has(second.type.name) ||
      (items.has(first.type.name) && first.type.name === second.type.name))
  if (!sameKind) return null
  if (nodeSuggestionOf(first) || nodeSuggestionOf(second)) return null

  // The lower line: a paragraph or heading, or an item that holds one line.
  let lower: ProseMirrorNode = second
  if (items.has(second.type.name)) {
    if (second.childCount !== 1 || !joinable.has(second.child(0).type.name))
      return null
    lower = second.child(0)
  }
  if (nodeSuggestionOf(lower)) return null
  const runs = plainRuns(lower)
  if (!runs) return null

  const joinAt = endOfLastLine(first, upper)
  if (joinAt === null) return null
  const deleteNodeID = second.attrs.nodeID as string
  if (!runs.length) return { transaction: null, deleteNodeID }
  const tr = state.tr.insert(joinAt, Fragment.from(runs))
  tr.setSelection(TextSelection.create(tr.doc, joinAt))
  return { transaction: tr, deleteNodeID }
}
