import type { Mark } from 'prosemirror-model'
import type { EditorState, Transaction } from 'prosemirror-state'
import { documentBodySchema } from './documentBody'
import type { InlineMarkName } from './inlineMarks'
import { UnsupportedSuggestionError, type TrackOptions } from './trackChanges'

// Formatting in Suggest mode (ADR 0027). Bold, italic, strike, and code on a
// selection are proposed, not applied: the text gets a suggestion_format mark
// holding the value it would take, and keeps its current formatting. Your own
// inserted text is not canonical yet, so formatting it is real.

/** The key a format suggestion uses for each inline mark. */
export const formatKeys = {
  strong: 'bold',
  em: 'italic',
  strike: 'strike',
  code: 'code',
} as const satisfies Record<InlineMarkName, string>

export type FormatKey = (typeof formatKeys)[InlineMarkName]

const marks = documentBodySchema.marks

type FormatSet = Partial<Record<FormatKey, boolean>>

const setOf = (mark: Mark): FormatSet =>
  typeof mark.attrs.set === 'object' && mark.attrs.set !== null
    ? (mark.attrs.set as FormatSet)
    : {}

/** Proposes toggling a mark on the selection: on unless all of it is already on. */
export function suggestFormat(
  state: EditorState,
  name: InlineMarkName,
  options: TrackOptions
): Transaction {
  const { from, to } = state.selection
  if (from === to) return state.tr
  const key = formatKeys[name]
  const type = marks[name]!

  type Piece = { start: number; end: number; marks: readonly Mark[] }
  const pieces: Piece[] = []
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true
    const start = Math.max(pos, from)
    const end = Math.min(pos + node.nodeSize, to)
    if (start < end) pieces.push({ start, end, marks: node.marks })
    return false
  })

  const kind = (piece: Piece, markName: string) =>
    piece.marks.find((mark) => mark.type.name === markName)
  const live = pieces.filter((piece) => !kind(piece, 'suggestion_delete'))
  for (const piece of live) {
    const insert = kind(piece, 'suggestion_insert')
    const format = kind(piece, 'suggestion_format')
    if (
      (insert && insert.attrs.author !== options.author) ||
      (format && format.attrs.author !== options.author)
    )
      throw new UnsupportedSuggestionError(
        'Decide the other suggestions in this text first.'
      )
  }

  const current = (piece: Piece) => {
    const set = kind(piece, 'suggestion_format')
    const proposed = set ? setOf(set)[key] : undefined
    return proposed ?? piece.marks.some((mark) => mark.type === type)
  }
  const target = !live.every(current)

  const tr = state.tr
  let id: string | null =
    live.map((piece) => kind(piece, 'suggestion_format')).find((mark) => mark)
      ?.attrs.id ?? null
  for (const piece of live) {
    const insert = kind(piece, 'suggestion_insert')
    if (insert) {
      if (target) tr.addMark(piece.start, piece.end, type.create())
      else tr.removeMark(piece.start, piece.end, type)
      continue
    }
    const existing = kind(piece, 'suggestion_format')
    const base = piece.marks.some((mark) => mark.type === type)
    const set: FormatSet = { ...(existing ? setOf(existing) : {}) }
    if (target === base) delete set[key]
    else set[key] = target
    if (existing) tr.removeMark(piece.start, piece.end, existing)
    if (Object.keys(set).length) {
      id ??= (options.newID ?? (() => crypto.randomUUID()))()
      tr.addMark(
        piece.start,
        piece.end,
        marks.suggestion_format!.create({ id, author: options.author, set })
      )
    }
  }
  return tr
}
