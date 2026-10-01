import type { NodeType } from 'prosemirror-model'
import {
  TextSelection,
  type EditorState,
  type Transaction,
} from 'prosemirror-state'
import { documentBodySchema } from '../documentBody'
import { insertBlock } from './insertBlock'

type Command = (
  state: EditorState,
  dispatch?: (tr: Transaction) => void
) => boolean

const nodes = documentBodySchema.nodes

export function isSafeImageSource(src: string) {
  const value = src.trim()
  if (!value) return false
  if (/^data:image\/(png|jpe?g|gif|webp|avif|bmp);/i.test(value)) return true
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return /^https?:/i.test(value)
  return !value.startsWith('//')
}

function create(
  type: NodeType,
  attributes: Record<string, unknown>,
  content?: string
) {
  return type.create(
    {
      nodeID: null,
      bodyAttributes: JSON.stringify(attributes),
      bodyContent: '',
    },
    content ? [documentBodySchema.text(content)] : []
  )
}

export const insertImage =
  (image: { src: string; alt: string }): Command =>
  (state, dispatch) => {
    if (!isSafeImageSource(image.src)) return false
    const { $from } = state.selection
    if (
      !$from.parent.canReplaceWith($from.index(), $from.index(), nodes.image!)
    )
      return false
    if (dispatch)
      dispatch(
        state.tr
          .replaceSelectionWith(
            create(nodes.image!, { src: image.src.trim(), alt: image.alt })
          )
          .scrollIntoView()
      )
    return true
  }

export const updateImage =
  (position: number, image: { src: string; alt: string }): Command =>
  (state, dispatch) => {
    const node = state.doc.nodeAt(position)
    if (node?.type !== nodes.image || !isSafeImageSource(image.src))
      return false
    if (dispatch) {
      const attributes = JSON.parse(node.attrs.bodyAttributes as string)
      dispatch(
        state.tr.setNodeMarkup(position, undefined, {
          ...node.attrs,
          bodyAttributes: JSON.stringify({
            ...attributes,
            src: image.src.trim(),
            alt: image.alt,
          }),
        })
      )
    }
    return true
  }

/** Inline math cannot be empty in the AST, so it starts with a placeholder. */
export const insertInlineMath: Command = (state, dispatch) => {
  const { $from } = state.selection
  if (!$from.parent.canReplaceWith($from.index(), $from.index(), nodes.math!))
    return false
  if (dispatch) {
    const tr = state.tr.replaceSelectionWith(
      create(nodes.math!, { marker: '$' }, 'x')
    )
    const start = state.selection.from
    tr.setSelection(TextSelection.create(tr.doc, start + 1, start + 2))
    dispatch(tr.scrollIntoView())
  }
  return true
}

export const insertMathBlock: Command = (state, dispatch) =>
  insertBlock(create(nodes.math_block!, { mathStyle: '' }))(state, dispatch)

const starterDiagram = 'graph TD\n  A[Start] --> B[Done]'

export const insertDiagram =
  (type: 'mermaid'): Command =>
  (state, dispatch) =>
    insertBlock(create(nodes.diagram!, { type, lang: 'yaml' }, starterDiagram))(
      state,
      dispatch
    )
