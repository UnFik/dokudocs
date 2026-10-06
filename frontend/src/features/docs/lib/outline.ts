import type { DocumentBodyNode } from './documentBody'

export type OutlineItem = { nodeID: string; level: number; text: string }

const headingTypes = new Set(['atx-heading', 'setext-heading'])

/** The headings of a document in order, with their level (1 to 6) and plain text. */
export function outlineOf(nodes: DocumentBodyNode[]): OutlineItem[] {
  const children = new Map<string | null, DocumentBodyNode[]>()
  for (const node of nodes) {
    const list = children.get(node.parentID) ?? []
    list.push(node)
    children.set(node.parentID, list)
  }
  const sorted = (parentID: string | null) =>
    (children.get(parentID) ?? [])
      .slice()
      .sort((a, b) => a.siblingOrder - b.siblingOrder)

  const items: OutlineItem[] = []
  const visit = (parentID: string | null) => {
    for (const node of sorted(parentID)) {
      if (headingTypes.has(node.type)) {
        const text = sorted(node.nodeID)
          .map((child) => child.content)
          .join('')
          .trim()
        const level = Number(node.attributes.level)
        if (text)
          items.push({
            nodeID: node.nodeID,
            level: Number.isFinite(level)
              ? Math.min(6, Math.max(1, Math.trunc(level)))
              : 1,
            text,
          })
      } else visit(node.nodeID)
    }
  }
  visit(null)
  return items
}

/**
 * The heading the reader is in: the last one whose top has reached `offset`
 * (the top of the page), or the first before any has.
 */
export function activeHeadingID(
  positions: { nodeID: string; top: number }[],
  offset: number
) {
  if (!positions.length) return null
  let active = positions[0]!.nodeID
  for (const position of positions) {
    if (position.top <= offset) active = position.nodeID
    else break
  }
  return active
}
