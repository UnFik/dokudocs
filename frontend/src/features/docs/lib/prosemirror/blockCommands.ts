import { InputRule } from 'prosemirror-inputrules'
import type { NodeType } from 'prosemirror-model'
import {
  TextSelection,
  type Command,
  type EditorState,
} from 'prosemirror-state'
import { documentBodySchema } from './documentBody'

const { atx_heading, paragraph, run, list_item, task_list_item } =
  documentBodySchema.nodes as Record<string, NodeType>

/** Depth of the paragraph or ATX heading that holds the cursor, or null. */
function textBlockDepth(state: EditorState) {
  const { $from, $to } = state.selection
  if (!$from.sameParent($to) && $from.depth !== $to.depth) return null
  for (let depth = $from.depth; depth > 0; depth--) {
    const type = $from.node(depth).type
    if (type === paragraph || type === atx_heading) return depth
    if (type !== run) return null
  }
  return null
}

function withBodyAttributes(
  attrs: Record<string, unknown>,
  change: Record<string, unknown> | null
) {
  const current = JSON.parse(String(attrs.bodyAttributes ?? '{}')) as Record<
    string,
    unknown
  >
  return {
    ...attrs,
    bodyAttributes: JSON.stringify(
      change === null ? {} : { ...current, ...change }
    ),
  }
}

/**
 * Change the block type in place. The block keeps its node ID, parent and
 * children, so no MoveNode or DeleteNode command is needed.
 */
export function setHeadingCommand(level: 0 | 1 | 2 | 3 | 4 | 5 | 6): Command {
  return (state, dispatch) => {
    const depth = textBlockDepth(state)
    if (depth === null) return false
    const { $from } = state.selection
    const block = $from.node(depth)
    const position = $from.before(depth)
    if (level === 0) {
      if (block.type === paragraph) return false
      dispatch?.(
        state.tr.setNodeMarkup(
          position,
          paragraph,
          withBodyAttributes(block.attrs, null)
        )
      )
      return true
    }
    const attrs =
      block.type === atx_heading
        ? withBodyAttributes(block.attrs, { level })
        : withBodyAttributes(
            { ...block.attrs, bodyAttributes: '{}' },
            { level }
          )
    dispatch?.(state.tr.setNodeMarkup(position, atx_heading, attrs))
    return true
  }
}

/**
 * "# " at the start of a paragraph becomes a heading. It only applies while the
 * run keeps some text: removing the marker from an otherwise empty run would
 * delete a run, which needs DeleteNode.
 */
export const headingInputRule = new InputRule(
  /^(#{1,6})\s$/,
  (state, match, start, end) => {
    const $start = state.doc.resolve(start)
    if (
      $start.parent.type !== run ||
      $start.node(-1).type !== paragraph ||
      $start.index(-1) !== 0 ||
      start !== $start.start() ||
      $start.parent.content.size <= end - start
    )
      return null
    const level = match[1]!.length as 1 | 2 | 3 | 4 | 5 | 6
    const tr = state.tr.delete(start, end)
    const blockPosition = tr.mapping.map($start.before(-1))
    const block = tr.doc.nodeAt(blockPosition)!
    return tr.setNodeMarkup(
      blockPosition,
      atx_heading,
      withBodyAttributes({ ...block.attrs, bodyAttributes: '{}' }, { level })
    )
  }
)

/**
 * Enter in a paragraph, heading or list item. Every node created by the split
 * gets a null ID, so prepareBodyTransaction issues fresh IDs while the first
 * half keeps the existing ones.
 */
export const splitTextBlock: Command = (state, dispatch) => {
  const blockDepth = textBlockDepth(state)
  if (blockDepth === null) return false
  const { $from } = state.selection
  const block = $from.node(blockDepth)
  const itemDepth = blockDepth - 1
  const item = blockDepth > 1 ? $from.node(itemDepth) : null
  const inItem = item?.type === list_item || item?.type === task_list_item
  const isLastInItem = inItem && $from.index(itemDepth) === item!.childCount - 1
  if (inItem && block.content.size === 0) return true

  const levels = $from.depth - blockDepth + 1 + (isLastInItem ? 1 : 0)
  const atEnd =
    $from.parentOffset === $from.parent.content.size &&
    $from.indexAfter(blockDepth) === block.childCount
  const types: { type: NodeType; attrs: Record<string, unknown> }[] = []
  for (let depth = $from.depth; depth > $from.depth - levels; depth--) {
    const node = $from.node(depth)
    const attrs = { ...node.attrs, nodeID: null }
    if (node.type === atx_heading && atEnd)
      types.unshift({
        type: paragraph,
        attrs: { ...attrs, bodyAttributes: '{}' },
      })
    else if (node.type === task_list_item)
      types.unshift({
        type: node.type,
        attrs: withBodyAttributes(attrs, { checked: false }),
      })
    else types.unshift({ type: node.type, attrs })
  }
  // The server rejects an empty run, so a split at the end of a run starts the
  // new block without one; typing wraps the first text in a fresh run.
  const atRunEnd =
    state.selection.empty &&
    $from.parent.type === run &&
    $from.parentOffset === $from.parent.content.size
  if (dispatch) {
    const tr = state.tr.deleteSelection()
    const from = tr.mapping.map(state.selection.from)
    if (atRunEnd) {
      tr.split(from + 1, levels - 1, types.slice(0, -1))
      tr.setSelection(
        TextSelection.near(tr.doc.resolve(tr.mapping.map(from + 1, 1)), 1)
      )
    } else tr.split(from, levels, types)
    dispatch(tr.scrollIntoView())
  }
  return true
}

/** Flip `checked` on the task item around the cursor; the item keeps its ID. */
export const toggleTaskChecked: Command = (state, dispatch) => {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const item = $from.node(depth)
    if (item.type !== task_list_item) continue
    const attrs = JSON.parse(String(item.attrs.bodyAttributes ?? '{}')) as {
      checked?: boolean
    }
    dispatch?.(
      state.tr.setNodeMarkup(
        $from.before(depth),
        undefined,
        withBodyAttributes(item.attrs, { checked: !attrs.checked })
      )
    )
    return true
  }
  return false
}

export type InsertableBlock = 'code-block' | 'thematic-break'

/**
 * Insert a new empty block after the paragraph or heading holding the cursor.
 * A new node under an existing parent is an ordinary edit; nothing existing is
 * moved or deleted, so it needs no MoveNode or DeleteNode.
 */
export function insertBlockCommand(kind: InsertableBlock): Command {
  return (state, dispatch) => {
    const depth = textBlockDepth(state)
    if (depth === null) return false
    const { $from } = state.selection
    const type =
      documentBodySchema.nodes[
        kind === 'code-block' ? 'code_block' : 'thematic_break'
      ]!
    const attrs =
      kind === 'code-block'
        ? {
            nodeID: null,
            bodyAttributes: JSON.stringify({
              type: 'fenced',
              lang: '',
              fenceLength: 3,
            }),
            bodyContent: '',
          }
        : { nodeID: null, bodyAttributes: '{}', bodyContent: '---' }
    const after = $from.after(depth)
    if (
      !$from
        .node(depth - 1)
        .canReplaceWith(
          $from.indexAfter(depth - 1),
          $from.indexAfter(depth - 1),
          type
        )
    )
      return false
    if (dispatch) {
      const tr = state.tr.insert(after, type.create(attrs))
      if (kind === 'code-block')
        tr.setSelection(TextSelection.create(tr.doc, after + 1))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}
