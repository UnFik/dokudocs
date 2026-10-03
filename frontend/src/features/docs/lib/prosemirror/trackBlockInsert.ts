import { Fragment, type Node as ProseMirrorNode } from 'prosemirror-model'
import {
  TextSelection,
  type EditorState,
  type Transaction,
} from 'prosemirror-state'
import { withNodeSuggestion } from './nodeSuggestion'
import { UnsupportedSuggestionError, type TrackOptions } from './trackChanges'

// A block from the "/" menu in Suggest mode (ADR 0027). The menu builds the
// block for an ordinary edit; here that edit is read back as the blocks it adds
// and they are inserted after the paragraph with an insert suggestion on each,
// so rejecting removes them whole and accepting clears the mark. The empty
// paragraph the menu was opened in stays where it is: turning it into another
// type would change a canonical block.

/** Set on the menu's transaction so the editor records it as a suggestion. */
export const blockMenuMeta = 'blockMenuInsert'

/** Menu entries that only change a paragraph's level carry it here. */
export type BlockMenuMeta = { headingLevel?: number }

/** What the card for an inserted block calls it; paragraphs and items need no label. */
export const blockLabels: Record<string, string> = {
  atx_heading: 'heading',
  bullet_list: 'bulleted list',
  order_list: 'numbered list',
  task_list: 'task list',
  block_quote: 'quote',
  code_block: 'code block',
  table: 'table',
  thematic_break: 'divider',
  math_block: 'math block',
  diagram: 'diagram',
}

/** The node with an ID of its own, and every node under it that has none yet. */
function withFreshIDs(node: ProseMirrorNode, own: boolean): ProseMirrorNode {
  if (node.isText) return node
  const children: ProseMirrorNode[] = []
  node.content.forEach((child) => children.push(withFreshIDs(child, false)))
  const needsID = 'nodeID' in node.attrs && (own || !node.attrs.nodeID)
  return node.type.create(
    needsID ? { ...node.attrs, nodeID: crypto.randomUUID() } : node.attrs,
    Fragment.from(children),
    node.marks
  )
}

export function suggestBlockInsert(
  state: EditorState,
  built: Transaction,
  options: TrackOptions
): Transaction {
  const start = state.doc.content.findDiffStart(built.doc.content)
  const end = state.doc.content.findDiffEnd(built.doc.content)
  if (start === null || !end)
    throw new UnsupportedSuggestionError('Nothing to insert here.')
  const replacedTo = Math.max(start, end.a)
  const slice = built.doc.slice(start, Math.max(start, end.b))
  if (slice.openStart !== 0 || slice.openEnd !== 0 || !slice.content.size)
    throw new UnsupportedSuggestionError(
      'This block cannot be added as a suggestion here yet.'
    )
  const id = (options.newID ?? (() => crypto.randomUUID()))()
  const blocks: ProseMirrorNode[] = []
  slice.content.forEach((node) => {
    const fresh = withFreshIDs(node, true)
    blocks.push(
      fresh.type.create(
        withNodeSuggestion(fresh, {
          kind: 'insert',
          id,
          author: options.author,
        }),
        fresh.content,
        fresh.marks
      )
    )
  })
  const tr = state.tr.insert(replacedTo, Fragment.from(blocks))
  const caret = built.selection.from
  const inside = caret >= start && caret <= start + slice.content.size
  if (inside) {
    const target = replacedTo + (caret - start)
    tr.setSelection(TextSelection.near(tr.doc.resolve(target)))
  }
  return tr
}
