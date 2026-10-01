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
 * Local edits may not remove an existing node (that needs the DeleteNode
 * command), so an empty paragraph is converted in place when the new block
 * holds text; any other block is inserted after the current one.
 */
export function insertBlock(block: ProseMirrorNode): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    if (!$from.parent.isTextblock || $from.depth < 1) return false
    for (let depth = $from.depth; depth > 0; depth--)
      if ($from.node(depth).type === documentBodySchema.nodes.table_cell)
        return false
    const depth = $from.depth
    const container = $from.node(depth - 1)
    const index = $from.index(depth - 1)
    const emptyParagraph =
      $from.parent.type === documentBodySchema.nodes.paragraph &&
      $from.parent.content.size === 0
    const inPlace =
      emptyParagraph &&
      block.isTextblock &&
      container.canReplaceWith(index, index + 1, block.type)
    if (!inPlace && !container.canReplaceWith(index + 1, index + 1, block.type))
      return false
    if (!dispatch) return true

    const tr = state.tr
    let cursor: number
    if (inPlace) {
      const start = $from.before(depth)
      tr.setNodeMarkup(start, block.type, {
        ...$from.parent.attrs,
        bodyAttributes: block.attrs.bodyAttributes,
      })
      if (block.content.size) tr.insert(start + 1, block.content)
      cursor = start + 1
    } else {
      const at = $from.after(depth)
      tr.insert(at, block)
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
}
