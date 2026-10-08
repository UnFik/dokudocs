import type { Mark } from 'prosemirror-model'
import type { EditorState, Transaction } from 'prosemirror-state'
import { documentBodySchema } from './documentBody'
import { normalizeLinkTarget, type InlineMarkName } from './inlineMarks'
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
  underline: 'underline',
  highlight: 'highlight',
} as const satisfies Record<InlineMarkName, string>

export type FormatKey = (typeof formatKeys)[InlineMarkName]

const marks = documentBodySchema.marks

type FormatSet = Record<string, boolean | string | undefined>

const setOf = (mark: Mark): FormatSet =>
  typeof mark.attrs.set === 'object' && mark.attrs.set !== null
    ? (mark.attrs.set as FormatSet)
    : {}

type Piece = { start: number; end: number; marks: readonly Mark[] }

const kindOf = (piece: Piece, markName: string) =>
  piece.marks.find((mark) => mark.type.name === markName)

/**
 * Proposes a formatting change on a range. `base` is a piece's value today,
 * `target` the value everything should take. Your own inserted text is formatted
 * for real; text under someone else's suggestion is refused.
 */
function proposeFormat<V extends boolean | string>(
  state: EditorState,
  range: { from: number; to: number },
  key: string,
  options: TrackOptions,
  how: {
    base: (piece: Piece) => V
    target: (current: (piece: Piece) => V, live: Piece[]) => V
    real: (tr: Transaction, piece: Piece, value: V) => void
  }
): Transaction {
  const { from, to } = range
  if (from === to) return state.tr
  const pieces: Piece[] = []
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true
    const start = Math.max(pos, from)
    const end = Math.min(pos + node.nodeSize, to)
    if (start < end) pieces.push({ start, end, marks: node.marks })
    return false
  })

  const live = pieces.filter((piece) => !kindOf(piece, 'suggestion_delete'))
  for (const piece of live) {
    const insert = kindOf(piece, 'suggestion_insert')
    const format = kindOf(piece, 'suggestion_format')
    if (
      (insert && insert.attrs.author !== options.author) ||
      (format && format.attrs.author !== options.author)
    )
      throw new UnsupportedSuggestionError(
        'Decide the other suggestions in this text first.'
      )
  }

  const current = (piece: Piece) => {
    const set = kindOf(piece, 'suggestion_format')
    const proposed = set ? setOf(set)[key] : undefined
    return (proposed ?? how.base(piece)) as V
  }
  const target = how.target(current, live)

  const tr = state.tr
  let id: string | null =
    live.map((piece) => kindOf(piece, 'suggestion_format')).find((mark) => mark)
      ?.attrs.id ?? null
  for (const piece of live) {
    if (kindOf(piece, 'suggestion_insert')) {
      how.real(tr, piece, target)
      continue
    }
    const existing = kindOf(piece, 'suggestion_format')
    const set: FormatSet = { ...(existing ? setOf(existing) : {}) }
    if (target === how.base(piece)) delete set[key]
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

/** Proposes toggling a mark on the selection: on unless all of it is already on. */
export function suggestFormat(
  state: EditorState,
  name: InlineMarkName,
  options: TrackOptions
): Transaction {
  const key = formatKeys[name]
  const type = marks[name]!
  return proposeFormat<boolean>(state, state.selection, key, options, {
    base: (piece) => piece.marks.some((mark) => mark.type === type),
    target: (current, live) => !live.every(current),
    real: (tr, piece, value) =>
      value
        ? tr.addMark(piece.start, piece.end, type.create())
        : tr.removeMark(piece.start, piece.end, type),
  })
}

/**
 * Proposes a link on a range, or taking the link off when `href` is null. The
 * proposal holds the address; an empty address means no link.
 */
export function suggestLink(
  state: EditorState,
  range: { from: number; to: number },
  href: string | null,
  options: TrackOptions
): Transaction {
  const target = href === null ? '' : normalizeLinkTarget(href)
  if (target === null)
    throw new UnsupportedSuggestionError(
      'Use an http, https, or mailto address, or a path that starts with / or #.'
    )
  const type = marks.link!
  return proposeFormat<string>(state, range, 'href', options, {
    base: (piece) =>
      (piece.marks.find((mark) => mark.type === type)?.attrs.href as
        | string
        | undefined) ?? '',
    target: () => target,
    real: (tr, piece, value) => {
      tr.removeMark(piece.start, piece.end, type)
      if (value)
        tr.addMark(piece.start, piece.end, type.create({ href: value }))
    },
  })
}
