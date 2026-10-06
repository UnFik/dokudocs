import { toggleMark } from 'prosemirror-commands'
import type { MarkType } from 'prosemirror-model'
import type { Command, EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { documentBodySchema } from './documentBody'

export type InlineMarkName =
  | 'strong'
  | 'em'
  | 'strike'
  | 'code'
  | 'underline'
  | 'highlight'

export interface InlineState {
  hasSelection: boolean
  marks: Record<InlineMarkName, boolean>
  link: string | null
  rect: { top: number; bottom: number; left: number; right: number } | null
}

const inlineMarkNames: InlineMarkName[] = [
  'strong',
  'em',
  'strike',
  'code',
  'underline',
  'highlight',
]
const safeLinkProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:'])

export const emptyInlineState: InlineState = {
  hasSelection: false,
  marks: {
    strong: false,
    em: false,
    strike: false,
    code: false,
    underline: false,
    highlight: false,
  },
  link: null,
  rect: null,
}

export function toggleInlineMark(name: InlineMarkName): Command {
  return toggleMark(documentBodySchema.marks[name]!)
}

/** Returns the trimmed target when it is safe to store as a link, else null. */
export function normalizeLinkTarget(value: string) {
  const target = value.trim()
  if (!target || /[\s<>"]/.test(target)) return null
  if (/^(#|\/(?!\/)|\.\.?\/)/.test(target)) return target
  try {
    return safeLinkProtocols.has(new URL(target).protocol) ? target : null
  } catch {
    return null
  }
}

export function setLinkCommand(href: string): Command {
  const target = normalizeLinkTarget(href)
  const linkType = documentBodySchema.marks.link!
  return (state, dispatch) => {
    const { from, to, empty } = state.selection
    if (!target || empty) return false
    if (
      !state.doc.rangeHasMark(from, to, linkType) &&
      !canMark(state, linkType)
    )
      return false
    dispatch?.(
      state.tr
        .removeMark(from, to, linkType)
        .addMark(from, to, linkType.create({ href: target }))
        .scrollIntoView()
    )
    return true
  }
}

export const removeLinkCommand: Command = (state, dispatch) => {
  const linkType = documentBodySchema.marks.link!
  const range = linkRange(state)
  if (!range) return false
  dispatch?.(state.tr.removeMark(range.from, range.to, linkType))
  return true
}

function canMark(state: EditorState, type: MarkType) {
  const { from, to } = state.selection
  let allowed = false
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isInline && node.type.name === 'text') allowed ||= true
    return !allowed
  })
  return allowed && state.doc.resolve(from).parent.type.allowsMarkType(type)
}

export function linkRange(state: EditorState) {
  const linkType = documentBodySchema.marks.link!
  const { from, to, empty, $from } = state.selection
  if (!empty)
    return state.doc.rangeHasMark(from, to, linkType) ? { from, to } : null
  const start = $from.parent.childAfter($from.parentOffset)
  const before = $from.parent.childBefore($from.parentOffset)
  const node = start.node?.marks.some((mark) => mark.type === linkType)
    ? start
    : before.node?.marks.some((mark) => mark.type === linkType)
      ? before
      : null
  if (!node?.node) return null
  const origin = $from.start() + node.offset
  return { from: origin, to: origin + node.node.nodeSize }
}

export function readInlineState(view: EditorView): InlineState {
  const { state } = view
  const { from, to, empty } = state.selection
  if (!state.selection.$from.parent.inlineContent) return emptyInlineState
  const marks = { ...emptyInlineState.marks }
  const linkType = documentBodySchema.marks.link!
  let link: string | null = null
  if (empty) {
    const active = state.storedMarks ?? state.selection.$from.marks()
    for (const name of inlineMarkNames)
      marks[name] = active.some((mark) => mark.type.name === name)
    link =
      (active.find((mark) => mark.type === linkType)?.attrs.href as
        | string
        | undefined) ?? null
  } else {
    for (const name of inlineMarkNames)
      marks[name] = state.doc.rangeHasMark(
        from,
        to,
        documentBodySchema.marks[name]!
      )
    state.doc.nodesBetween(from, to, (node) => {
      const mark = node.marks.find((item) => item.type === linkType)
      if (mark && link === null) link = mark.attrs.href as string
    })
  }
  let rect: InlineState['rect'] = null
  if (!empty) {
    try {
      const start = view.coordsAtPos(from)
      const end = view.coordsAtPos(to)
      rect = {
        top: Math.min(start.top, end.top),
        bottom: Math.max(start.bottom, end.bottom),
        left: Math.min(start.left, end.left),
        right: Math.max(start.right, end.right),
      }
    } catch {
      rect = null
    }
  }
  return { hasSelection: !empty, marks, link, rect }
}
