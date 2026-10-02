import type { Node as ProseMirrorNode } from 'prosemirror-model'

export type SelectionDeletionPlan =
  | {
      ok: true
      /** Subtrees to delete through DeleteNode: whole blocks and whole runs. */
      roots: string[]
      /** Text ranges inside runs that keep some text; ordinary edits. */
      trims: { from: number; to: number }[]
    }
  | { ok: false; message: string }

const refusal =
  'This selection includes content that cannot be deleted in one step. Select plain text and whole blocks only.'

function nodeIDOf(node: ProseMirrorNode) {
  return typeof node.attrs.nodeID === 'string'
    ? (node.attrs.nodeID as string)
    : null
}

function hasOpaque(node: ProseMirrorNode) {
  if (node.type.name === 'opaque') return true
  let found = false
  node.descendants((child) => {
    if (child.type.name === 'opaque' || child.type.name === 'opaque-inline')
      found = true
    return !found
  })
  return found
}

/** The textblock that holds a position, if any. */
export function textblockAt(doc: ProseMirrorNode, pos: number) {
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth--)
    if ($pos.node(depth).isTextblock) return $pos.node(depth)
  return null
}

/**
 * Splits a selection that crosses blocks into what DeleteNode can remove (blocks
 * and runs the selection covers entirely) and the text left at its ragged ends,
 * which is trimmed with ordinary edits.
 */
export function planSelectionDeletion(
  doc: ProseMirrorNode,
  from: number,
  to: number
): SelectionDeletionPlan {
  const roots: string[] = []
  const trims: { from: number; to: number }[] = []
  let refused = false
  doc.nodesBetween(from, to, (node, pos) => {
    if (refused) return false
    if (node === doc || node.type.name === 'document') return true
    const nodeID = nodeIDOf(node)
    const covered = from <= pos && pos + node.nodeSize <= to
    if (node.isBlock && nodeID && covered) {
      // A cell on its own would leave a ragged table; a row is fine.
      if (node.type.name === 'table_cell' || hasOpaque(node)) refused = true
      else roots.push(nodeID)
      return false
    }
    if (!node.isTextblock) return true
    node.forEach((child, offset) => {
      const start = pos + 1 + offset
      const end = start + child.nodeSize
      const cutFrom = Math.max(from, start)
      const cutTo = Math.min(to, end)
      if (cutFrom >= cutTo) return
      const childID = nodeIDOf(child)
      if (child.type.name !== 'run' || !childID) {
        refused = true
        return
      }
      if (cutFrom <= start && cutTo >= end) roots.push(childID)
      else
        trims.push({
          from: Math.max(cutFrom, start + 1),
          to: Math.min(cutTo, end - 1),
        })
    })
    return false
  })
  if (refused || (!roots.length && !trims.length))
    return { ok: false, message: refusal }
  return { ok: true, roots, trims }
}
