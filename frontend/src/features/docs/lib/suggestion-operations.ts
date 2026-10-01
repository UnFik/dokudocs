import type { DocumentBodyNode } from './documentBody'

export type SuggestionOperation = { op: 'delete'; nodeID: string }

export function buildDeleteBlockSuggestion(
  nodes: DocumentBodyNode[],
  nodeID: string
): { operations: SuggestionOperation[]; summary: string } {
  const byID = new Map(nodes.map((item) => [item.nodeID, item]))
  let block = byID.get(nodeID)
  if (!block) throw new Error('The selected block is no longer current')
  if (block.type === 'run' && block.parentID)
    block = byID.get(block.parentID) ?? block
  if (block.parentID === null)
    throw new Error('The document root cannot be deleted')
  if (block.type === 'opaque' || block.type === 'opaque-inline')
    throw new Error('This block cannot be changed by a suggestion')
  const text = nodes
    .filter((item) => item.parentID === block.nodeID && item.type === 'run')
    .map((item) => item.content)
    .join('')
    .slice(0, 80)
  return {
    operations: [{ op: 'delete', nodeID: block.nodeID }],
    summary: text ? `Delete ${block.type} “${text}”` : `Delete ${block.type}`,
  }
}

export function conflictReviewMessage(status: string): string | null {
  return status === 'conflicted'
    ? 'Not applied: the document changed since this was proposed. Nothing was edited. Ask for a new suggestion on the current text.'
    : null
}
