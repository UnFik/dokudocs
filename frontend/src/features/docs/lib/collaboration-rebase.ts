import type { DocumentBodyNode } from './documentBody'

export type RebaseConflict = {
  nodeID: string
  reason: 'node-deleted' | 'parent-deleted' | 'concurrent-edit'
}

export type RebaseResult = {
  nodes: DocumentBodyNode[]
  conflicts: RebaseConflict[]
}

/**
 * Three-way merge of pending local edits onto a newer canonical body, keyed by
 * stable nodeID. `base` is the body the local edits started from, `local` is
 * base plus the pending edits. Edits that cannot be applied safely are reported
 * as conflicts and left out of `nodes`, which then stays equal to canonical for
 * those nodes. Structural moves and deletes are commands and never rebased here.
 */
export function rebasePendingEdits(input: {
  base: DocumentBodyNode[]
  local: DocumentBodyNode[]
  canonical: DocumentBodyNode[]
}): RebaseResult {
  const baseByID = new Map(input.base.map((node) => [node.nodeID, node]))
  const canonicalByID = new Map(
    input.canonical.map((node) => [node.nodeID, node])
  )
  const localChildren = childrenOf(input.local)
  const merged = new Map<string, DocumentBodyNode>()
  const inserted: DocumentBodyNode[] = []
  const conflicts: RebaseConflict[] = []

  for (const local of input.local) {
    const base = baseByID.get(local.nodeID)
    if (!base || sameNodeContent(base, local)) continue
    const canonical = canonicalByID.get(local.nodeID)
    if (!canonical) {
      conflicts.push({ nodeID: local.nodeID, reason: 'node-deleted' })
      continue
    }
    const next = mergeNode(base, local, canonical)
    if (next) merged.set(local.nodeID, next)
    else conflicts.push({ nodeID: local.nodeID, reason: 'concurrent-edit' })
  }

  const live = (nodeID: string) =>
    canonicalByID.has(nodeID) ||
    inserted.some((candidate) => candidate.nodeID === nodeID)
  const orderedLocal = (parentID: string): DocumentBodyNode[] => {
    const out: DocumentBodyNode[] = []
    for (const child of localChildren.get(parentID) ?? []) {
      out.push(child, ...orderedLocal(child.nodeID))
    }
    return out
  }
  const root = input.local.find((node) => node.parentID === null)
  const insertCandidates = root
    ? orderedLocal(root.nodeID).filter((node) => !baseByID.has(node.nodeID))
    : []
  const droppedInserts = new Set<string>()
  for (const local of insertCandidates) {
    if (canonicalByID.has(local.nodeID)) continue
    if (
      local.parentID === null ||
      droppedInserts.has(local.parentID) ||
      !live(local.parentID)
    ) {
      droppedInserts.add(local.nodeID)
      conflicts.push({ nodeID: local.nodeID, reason: 'parent-deleted' })
      continue
    }
    inserted.push({ ...local })
  }

  const nodes = input.canonical.map((node) => merged.get(node.nodeID) ?? node)
  const result = [...nodes, ...inserted]
  placeInsertedSiblings(result, inserted, localChildren)
  return { nodes: result, conflicts }
}

function childrenOf(nodes: DocumentBodyNode[]) {
  const children = new Map<string, DocumentBodyNode[]>()
  for (const node of nodes) {
    if (node.parentID === null) continue
    const siblings = children.get(node.parentID) ?? []
    siblings.push(node)
    children.set(node.parentID, siblings)
  }
  for (const siblings of children.values())
    siblings.sort((left, right) => left.siblingOrder - right.siblingOrder)
  return children
}

function placeInsertedSiblings(
  nodes: DocumentBodyNode[],
  inserted: DocumentBodyNode[],
  localChildren: Map<string, DocumentBodyNode[]>
) {
  if (!inserted.length) return
  const byID = new Map(nodes.map((node, index) => [node.nodeID, index]))
  const insertedIDs = new Set(inserted.map((node) => node.nodeID))
  const parents = new Set(inserted.map((node) => node.parentID!))
  for (const parentID of parents) {
    const order = nodes
      .filter(
        (node) => node.parentID === parentID && !insertedIDs.has(node.nodeID)
      )
      .sort((left, right) => left.siblingOrder - right.siblingOrder)
      .map((node) => node.nodeID)
    for (const local of localChildren.get(parentID) ?? []) {
      if (!insertedIDs.has(local.nodeID)) continue
      const localSiblings = localChildren.get(parentID)!
      let at = 0
      for (let i = localSiblings.indexOf(local) - 1; i >= 0; i--) {
        const found = order.indexOf(localSiblings[i]!.nodeID)
        if (found >= 0) {
          at = found + 1
          break
        }
      }
      order.splice(at, 0, local.nodeID)
    }
    order.forEach((nodeID, index) => {
      const position = byID.get(nodeID)
      if (position === undefined) return
      nodes[position] = { ...nodes[position]!, siblingOrder: index + 1 }
    })
  }
}

function sameNodeContent(left: DocumentBodyNode, right: DocumentBodyNode) {
  return (
    left.type === right.type &&
    left.content === right.content &&
    JSON.stringify(left.attributes) === JSON.stringify(right.attributes)
  )
}

function mergeNode(
  base: DocumentBodyNode,
  local: DocumentBodyNode,
  canonical: DocumentBodyNode
): DocumentBodyNode | null {
  if (sameNodeContent(local, canonical)) return canonical
  if (sameNodeContent(base, canonical)) return { ...canonical, ...local }
  const sameShape =
    local.type === base.type &&
    canonical.type === base.type &&
    JSON.stringify(local.attributes) === JSON.stringify(base.attributes) &&
    JSON.stringify(canonical.attributes) === JSON.stringify(base.attributes)
  if (!sameShape) return null
  const content = mergeText(base.content, local.content, canonical.content)
  return content === null ? null : { ...canonical, content }
}

function changedRegion(base: string, next: string) {
  const limit = Math.min(base.length, next.length)
  let start = 0
  while (start < limit && base[start] === next[start]) start++
  let suffix = 0
  while (
    suffix < limit - start &&
    base[base.length - 1 - suffix] === next[next.length - 1 - suffix]
  )
    suffix++
  return {
    start,
    end: base.length - suffix,
    replacement: next.slice(start, next.length - suffix),
  }
}

function mergeText(base: string, local: string, canonical: string) {
  const l = changedRegion(base, local)
  const c = changedRegion(base, canonical)
  if (l.start === l.end && c.start === c.end && l.start === c.start) return null
  if (l.end <= c.start)
    return (
      base.slice(0, l.start) +
      l.replacement +
      base.slice(l.end, c.start) +
      c.replacement +
      base.slice(c.end)
    )
  if (c.end <= l.start)
    return (
      base.slice(0, c.start) +
      c.replacement +
      base.slice(c.end, l.start) +
      l.replacement +
      base.slice(l.end)
    )
  return null
}
