import type { Node as ProseMirrorNode } from 'prosemirror-model'
import {
  TextSelection,
  type EditorState,
  type Transaction,
} from 'prosemirror-state'
import { documentBodySchema } from '../documentBody'

export type Command = (
  state: EditorState,
  dispatch?: (tr: Transaction) => void
) => boolean

export function createNode(
  typeName: string,
  attributes: Record<string, unknown>,
  content: ProseMirrorNode[] | string = []
) {
  const type = documentBodySchema.nodes[typeName]
  if (!type) throw new Error(`unknown node type ${typeName}`)
  return type.create(
    {
      nodeID: null,
      bodyAttributes: JSON.stringify(attributes),
      bodyContent: '',
    },
    typeof content === 'string'
      ? content
        ? [documentBodySchema.text(content)]
        : []
      : content
  )
}

/**
 * The new block takes the place of the empty paragraph the caret is in (a
 * heading just changes that paragraph's type); in a line that has text it goes
 * after it.
 */
export function insertBlock(block: ProseMirrorNode): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    for (let depth = $from.depth; depth > 0; depth--)
      if ($from.node(depth).type === documentBodySchema.nodes.table_cell)
        return false

    // The cursor usually sits in a run; climb to the first block that has a
    // parent able to hold the new block.
    for (let depth = $from.depth; depth > 0; depth--) {
      const current = $from.node(depth)
      const container = $from.node(depth - 1)
      const index = $from.index(depth - 1)
      const blank =
        current.type === documentBodySchema.nodes.paragraph &&
        current.content.size === 0 &&
        container.canReplaceWith(index, index + 1, block.type)
      const inPlace = blank && block.isTextblock
      const replaces = blank && !block.isTextblock
      if (
        !inPlace &&
        !replaces &&
        !container.canReplaceWith(index + 1, index + 1, block.type)
      )
        continue
      if (!dispatch) return true

      const tr = state.tr
      let cursor: number
      if (inPlace) {
        const start = $from.before(depth)
        tr.setNodeMarkup(start, block.type, {
          ...current.attrs,
          bodyAttributes: block.attrs.bodyAttributes,
        })
        if (block.content.size) tr.insert(start + 1, block.content)
        cursor = start + 1
      } else {
        const at = replaces ? $from.before(depth) : $from.after(depth)
        if (replaces) tr.replaceWith(at, $from.after(depth), block)
        else tr.insert(at, block)
        cursor = at + 1
        for (
          let node = block;
          node.firstChild && !node.isTextblock;
          node = node.firstChild
        )
          cursor++
      }
      tr.setSelection(TextSelection.near(tr.doc.resolve(cursor)))
      dispatch(tr.scrollIntoView())
      return true
    }
    return false
  }
}

/**
 * Inline nodes live beside runs, not inside them, so a cursor in the middle of
 * a run splits it first. Returns the transaction and where the node landed.
 */
export function insertInline(
  state: EditorState,
  node: ProseMirrorNode
): { tr: Transaction; at: number } | null {
  const { $from } = state.selection
  const tr = state.tr
  let at = $from.pos
  const depth = $from.depth
  if ($from.parent.type === documentBodySchema.nodes.run) {
    const offset = $from.parentOffset
    if (offset === 0) at = $from.before(depth)
    else if (offset === $from.parent.content.size) at = $from.after(depth)
    else {
      tr.split($from.pos)
      at = $from.pos + 1
    }
  }
  const resolved = tr.doc.resolve(at)
  if (
    !resolved.parent.canReplaceWith(
      resolved.index(),
      resolved.index(),
      node.type
    )
  )
    return null
  tr.insert(at, node)
  return { tr, at }
}
