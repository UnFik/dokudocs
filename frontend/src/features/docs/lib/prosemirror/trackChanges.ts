import type { Mark, Node as ProseMirrorNode } from 'prosemirror-model'
import {
  TextSelection,
  type EditorState,
  type Transaction,
} from 'prosemirror-state'
import { documentBodySchema } from './documentBody'
import { nodeSuggestionOf, withNodeSuggestion } from './nodeSuggestion'

// Suggest mode (ADR 0027). A user edits as usual and the edit is recorded as
// suggestion marks on the text instead of changing it: typed text carries an
// insert mark, text to remove carries a delete mark. Deleting your own suggested
// insertion really removes it. Which suggestion an edit belongs to follows what
// it touches: next to your own suggestion it joins it, so deleting text and
// typing right there is one Replace; anywhere else it starts a new one.

export type TrackOptions = {
  /** The user making the suggestion; a UUID, as the server requires. */
  author: string
  /** Makes the id of a new suggestion. */
  newID?: () => string
  /** Where the caret goes after a deletion: before the deleted text (Backspace) or after it (Delete). Typing always ends after the typed text. */
  caret?: 'start' | 'end'
}

/** A change Suggest mode cannot record as a suggestion. */
export class UnsupportedSuggestionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedSuggestionError'
  }
}

const marks = documentBodySchema.marks

type Chunk = { start: number; end: number; marks: readonly Mark[] }

const isSuggestion = (mark: Mark) => mark.type.name.startsWith('suggestion_')

function markOf(chunk: Chunk, kind: 'insert' | 'delete') {
  return chunk.marks.find((mark) => mark.type.name === `suggestion_${kind}`)
}

/** The textblock around a position, with the position where its content starts. */
function textblockAt(doc: ProseMirrorNode, pos: number) {
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth--)
    if ($pos.node(depth).isTextblock)
      return {
        node: $pos.node(depth),
        start: $pos.start(depth),
        end: $pos.end(depth),
      }
  return null
}

/** The text of a textblock in pieces, one per text node, with document positions. */
function chunksOf(block: { node: ProseMirrorNode; start: number }) {
  const chunks: Chunk[] = []
  block.node.descendants((node, offset) => {
    if (node.isText)
      chunks.push({
        start: block.start + offset,
        end: block.start + offset + node.nodeSize,
        marks: node.marks,
      })
    return true
  })
  return chunks
}

// Between two runs of one paragraph sit the closing and opening tokens of the
// runs, so text on either side of a position is at most two positions away.
const runGap = 2

function ownIDNextTo(
  chunks: Chunk[],
  from: number,
  to: number,
  author: string
) {
  const own = (chunk: Chunk) => {
    for (const kind of ['insert', 'delete'] as const) {
      const mark = markOf(chunk, kind)
      if (mark && mark.attrs.author === author) return mark.attrs.id as string
    }
    return null
  }
  const inside = chunks.filter((chunk) => chunk.end > from && chunk.start < to)
  for (const chunk of inside) {
    const id = own(chunk)
    if (id) return id
  }
  // The character just left of `from` and just right of `to`: inside a piece of
  // text it belongs to that piece, and across a run boundary to the nearest one.
  const before =
    chunks.find((chunk) => chunk.start < from && from <= chunk.end) ??
    chunks
      .filter((chunk) => chunk.end <= from && from - chunk.end <= runGap)
      .at(-1)
  const after =
    chunks.find((chunk) => chunk.start <= to && to < chunk.end) ??
    chunks.find((chunk) => chunk.start >= to && chunk.start - to <= runGap)
  return (before && own(before)) || (after && own(after)) || null
}

/** Replaces [from, to) with text as a suggestion: the old text is proposed for deletion, the new text for insertion. */
export function suggestReplace(
  state: EditorState,
  from: number,
  to: number,
  text: string,
  options: TrackOptions
): Transaction {
  const doc = state.doc
  const block = textblockAt(doc, from)
  const lastBlock = textblockAt(doc, to)
  if (!block || !lastBlock || block.start !== lastBlock.start)
    throw new UnsupportedSuggestionError(
      'A suggestion can change text inside one paragraph at a time.'
    )
  const chunks = chunksOf(block)

  // What happens to each piece of the range: your own insertion is removed
  // for real; anything not already deleted is marked as deleted.
  const toRemove: Chunk[] = []
  const toMark: Chunk[] = []
  for (const chunk of chunks) {
    const start = Math.max(chunk.start, from)
    const end = Math.min(chunk.end, to)
    if (start >= end || markOf(chunk, 'delete')) continue
    const piece = { start, end, marks: chunk.marks }
    const insert = markOf(chunk, 'insert')
    if (insert && insert.attrs.author === options.author) toRemove.push(piece)
    else toMark.push(piece)
  }
  if (!text && !toRemove.length && !toMark.length) return state.tr

  const tr = state.tr
  let id: string | null = null
  const suggestionID = () =>
    (id ??=
      ownIDNextTo(chunks, from, to, options.author) ??
      (options.newID ?? (() => crypto.randomUUID()))())

  // Work from the right, so earlier positions stay valid.
  let afterInsert = 0
  if (text) {
    const formatting = doc
      .resolve(to)
      .marks()
      .filter((mark) => !isSuggestion(mark))
    const insert = marks.suggestion_insert!.create({
      id: suggestionID(),
      author: options.author,
    })
    tr.replaceWith(
      to,
      to,
      documentBodySchema.text(text, [...formatting, insert])
    )
    afterInsert = tr.steps.length
  }
  if (toMark.length) {
    const mark = marks.suggestion_delete!.create({
      id: suggestionID(),
      author: options.author,
    })
    for (const chunk of [...toMark].reverse())
      tr.addMark(chunk.start, chunk.end, mark)
  }
  for (const chunk of [...toRemove].reverse()) {
    const run = doc.resolve(chunk.start).parent
    const wholeRun =
      run.type.name === 'run' && run.content.size === chunk.end - chunk.start
    // A run that is only the removed text goes with it.
    if (wholeRun) tr.delete(chunk.start - 1, chunk.end + 1)
    else tr.delete(chunk.start, chunk.end)
  }

  const caretAt = text
    ? tr.mapping.slice(afterInsert).map(to + text.length, 1)
    : tr.mapping.map(
        options.caret === 'end' ? to : from,
        options.caret === 'end' ? -1 : -1
      )
  tr.setSelection(TextSelection.create(tr.doc, caretAt))
  return tr
}

const isOpaque = (node: ProseMirrorNode) => {
  let found = node.type.name === 'opaque'
  node.descendants((child) => {
    if (child.type.name === 'opaque' || child.type.name === 'opaque-inline')
      found = true
    return !found
  })
  return found
}

/**
 * Proposes deleting a selection that spans blocks, as one suggestion: a block the
 * selection covers entirely is marked as deleted, and the text at its ragged
 * ends gets delete marks. A block you inserted yourself is removed for real.
 */
export function suggestDelete(
  state: EditorState,
  from: number,
  to: number,
  options: TrackOptions
): Transaction {
  const doc = state.doc
  type Operation = { at: number; apply: (tr: Transaction, id: string) => void }
  const operations: Operation[] = []

  doc.nodesBetween(from, to, (node, pos) => {
    if (node === doc || node.type.name === 'document') return true
    const nodeID = node.attrs.nodeID
    const covered = from <= pos && pos + node.nodeSize <= to
    if (node.isBlock && typeof nodeID === 'string' && covered) {
      if (node.type.name === 'table_cell' || isOpaque(node))
        throw new UnsupportedSuggestionError(
          'This selection includes content that cannot be deleted by a suggestion.'
        )
      const existing = nodeSuggestionOf(node)
      if (existing?.kind === 'delete') return false
      if (existing?.kind === 'insert' && existing.author === options.author)
        operations.push({
          at: pos,
          apply: (tr) => {
            tr.delete(pos, pos + node.nodeSize)
          },
        })
      else
        operations.push({
          at: pos,
          apply: (tr, id) => {
            tr.setNodeMarkup(
              pos,
              undefined,
              withNodeSuggestion(node, {
                kind: 'delete',
                id,
                author: options.author,
              })
            )
          },
        })
      return false
    }
    if (!node.isTextblock) return true
    const block = { node, start: pos + 1 }
    for (const chunk of chunksOf(block)) {
      const start = Math.max(chunk.start, from)
      const end = Math.min(chunk.end, to)
      if (start >= end || markOf(chunk, 'delete')) continue
      const insert = markOf(chunk, 'insert')
      const own = insert && insert.attrs.author === options.author
      const whole =
        own &&
        doc.resolve(start).parent.type.name === 'run' &&
        doc.resolve(start).parent.content.size === end - start
      operations.push({
        at: start,
        apply: (tr, id) => {
          if (own && whole) tr.delete(start - 1, end + 1)
          else if (own) tr.delete(start, end)
          else
            tr.addMark(
              start,
              end,
              marks.suggestion_delete!.create({ id, author: options.author })
            )
        },
      })
    }
    return false
  })

  const tr = state.tr
  if (!operations.length) return tr
  const id = (options.newID ?? (() => crypto.randomUUID()))()
  for (const operation of operations.sort((a, b) => b.at - a.at))
    operation.apply(tr, id)
  return tr
}
