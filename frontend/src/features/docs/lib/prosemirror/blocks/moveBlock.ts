import type { EditorState, Transaction } from 'prosemirror-state'

/**
 * Builds the delete-and-insert transaction for moving one top-level block to
 * the gap `targetIndex` (0..childCount). The editor recognizes it as a move
 * and sends the MoveNode command instead of applying it locally.
 */
export function moveTopLevelBlock(
  state: EditorState,
  fromIndex: number,
  targetIndex: number
): Transaction | null {
  const documentNode = state.doc.child(0)
  if (
    fromIndex < 0 ||
    fromIndex >= documentNode.childCount ||
    targetIndex < 0 ||
    targetIndex > documentNode.childCount ||
    targetIndex === fromIndex ||
    targetIndex === fromIndex + 1
  )
    return null
  const offsetOf = (index: number) => {
    let offset = 1
    for (let i = 0; i < index; i++) offset += documentNode.child(i).nodeSize
    return offset
  }
  const node = documentNode.child(fromIndex)
  const from = offsetOf(fromIndex)
  const target = offsetOf(targetIndex)
  const tr = state.tr.delete(from, from + node.nodeSize)
  tr.insert(tr.mapping.map(target, -1), node)
  return tr
}
