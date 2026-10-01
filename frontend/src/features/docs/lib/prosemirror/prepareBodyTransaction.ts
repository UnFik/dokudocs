import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { EditorState, Transaction } from 'prosemirror-state'
import type { DocumentBodyNode } from '../documentBody'
import { documentBodySchema, prosemirrorToDocumentBody } from './documentBody'

const inlineParentNames = new Set([
  'paragraph',
  'atx_heading',
  'setext_heading',
  'table_cell',
])

export class DeleteNodeRequiredError extends Error {
  constructor(readonly nodeID: string) {
    super(`deleting node ${nodeID} requires DeleteNode`)
    this.name = 'DeleteNodeRequiredError'
  }
}

export class MoveNodeRequiredError extends Error {
  constructor(
    readonly nodeID: string,
    readonly targetParentID: string,
    readonly beforeNodeID: string | null
  ) {
    super(`moving node ${nodeID} requires MoveNode`)
    this.name = 'MoveNodeRequiredError'
  }
}

/** Normalize one local transaction before dispatching it to the Yjs binding. */
export function prepareBodyTransaction(
  state: EditorState,
  transaction: Transaction,
  options: { authorizedMoveNodeIDs?: ReadonlySet<string> } = {}
): Transaction {
  if (!transaction.docChanged) return transaction

  const before = prosemirrorToDocumentBody(state.doc)
  wrapRawInlineText(transaction)
  splitRunsWithMixedMarks(transaction)
  assignNodeIDs(transaction)
  transaction.doc.check()

  let after = prosemirrorToDocumentBody(transaction.doc)
  reassignChildrenMovedFromDeletedParents(
    transaction,
    before,
    after,
    options.authorizedMoveNodeIDs ?? new Set()
  )
  after = prosemirrorToDocumentBody(transaction.doc)
  validateOpaquePreservation(before, after)
  const deleteNodeID = isolatedDeletedSubtree(before, after)
  if (deleteNodeID) throw new DeleteNodeRequiredError(deleteNodeID)
  const move = singleMoveCommand(before, after)
  if (move && !options.authorizedMoveNodeIDs?.has(move.nodeID))
    throw new MoveNodeRequiredError(
      move.nodeID,
      move.targetParentID,
      move.beforeNodeID
    )
  validateStructuralChanges(
    before,
    after,
    options.authorizedMoveNodeIDs ?? new Set()
  )
  return transaction
}

function singleMoveCommand(
  before: DocumentBodyNode[],
  after: DocumentBodyNode[]
) {
  const oldNodes = new Map(before.map((node) => [node.nodeID, node]))
  const newNodes = new Map(after.map((node) => [node.nodeID, node]))
  if (oldNodes.size !== newNodes.size) return null
  for (const [nodeID, oldNode] of oldNodes) {
    const newNode = newNodes.get(nodeID)
    if (
      !newNode ||
      oldNode.type !== newNode.type ||
      oldNode.content !== newNode.content ||
      JSON.stringify(oldNode.attributes) !== JSON.stringify(newNode.attributes)
    )
      return null
  }

  const oldChildren = indexByParent(before)
  const newChildren = indexByParent(after)
  for (const oldNode of before) {
    if (oldNode.parentID === null) continue
    const newNode = newNodes.get(oldNode.nodeID)!
    if (
      oldNode.parentID === newNode.parentID &&
      sameNodeIDs(
        oldChildren.get(oldNode.parentID) ?? [],
        newChildren.get(newNode.parentID) ?? []
      )
    )
      continue

    const expected = new Map(
      [...oldChildren].map(([parentID, children]) => [
        parentID,
        children.map((child) => child.nodeID),
      ])
    )
    const source = expected.get(oldNode.parentID)!
    source.splice(source.indexOf(oldNode.nodeID), 1)
    const target = expected.get(newNode.parentID) ?? []
    const targetChildren = (newChildren.get(newNode.parentID) ?? []).map(
      (child) => child.nodeID
    )
    const movedIndex = targetChildren.indexOf(oldNode.nodeID)
    if (movedIndex < 0) continue
    const beforeNodeID = targetChildren[movedIndex + 1] ?? null
    const insertAt =
      beforeNodeID === null ? target.length : target.indexOf(beforeNodeID)
    if (insertAt < 0) continue
    target.splice(insertAt, 0, oldNode.nodeID)
    expected.set(newNode.parentID, target)

    const parentIDs = new Set([...expected.keys(), ...newChildren.keys()])
    if (
      [...parentIDs].every((parentID) =>
        sameStrings(
          expected.get(parentID) ?? [],
          (newChildren.get(parentID) ?? []).map((node) => node.nodeID)
        )
      )
    )
      return {
        nodeID: oldNode.nodeID,
        targetParentID: newNode.parentID!,
        beforeNodeID,
      }
  }
  return null
}

function sameNodeIDs(left: DocumentBodyNode[], right: DocumentBodyNode[]) {
  return sameStrings(
    left.map((node) => node.nodeID),
    right.map((node) => node.nodeID)
  )
}

function sameStrings(left: string[], right: string[]) {
  return (
    left.length === right.length && left.every((value, i) => value === right[i])
  )
}

function isolatedDeletedSubtree(
  before: DocumentBodyNode[],
  after: DocumentBodyNode[]
) {
  const newNodes = new Map(after.map((node) => [node.nodeID, node]))
  const removed = before.filter((node) => !newNodes.has(node.nodeID))
  if (!removed.length) return undefined
  const removedIDs = new Set(removed.map((node) => node.nodeID))
  const roots = removed.filter(
    (node) => node.parentID === null || !removedIDs.has(node.parentID)
  )
  if (roots.length !== 1) return undefined

  const root = roots[0]!
  if (root.parentID === null) return undefined
  const oldNodes = new Map(before.map((node) => [node.nodeID, node]))
  const isInsideDeletedSubtree = (node: DocumentBodyNode) => {
    let parentID = node.parentID
    while (parentID !== null) {
      if (parentID === root.nodeID) return true
      parentID = oldNodes.get(parentID)?.parentID ?? null
    }
    return node.nodeID === root.nodeID
  }
  const survivors = before.filter((node) => !isInsideDeletedSubtree(node))
  if (after.length !== survivors.length) return undefined
  for (const oldNode of survivors) {
    const newNode = newNodes.get(oldNode.nodeID)
    if (
      !newNode ||
      oldNode.parentID !== newNode.parentID ||
      oldNode.type !== newNode.type ||
      oldNode.content !== newNode.content ||
      JSON.stringify(oldNode.attributes) !== JSON.stringify(newNode.attributes)
    )
      return undefined
  }
  return root.nodeID
}

function wrapRawInlineText(transaction: Transaction) {
  const parents: { node: ProseMirrorNode; position: number }[] = []
  transaction.doc.descendants((node, position) => {
    if (!inlineParentNames.has(node.type.name)) return true
    const children = Array.from({ length: node.childCount }, (_, i) =>
      node.child(i)
    )
    const hasRawText = children.some((child) => child.isText)
    if (
      hasRawText &&
      (children.some((child) => !child.isText) ||
        children.some((child) => child.isText && child.marks.length > 0))
    )
      parents.push({ node, position })
    return true
  })

  for (const { node, position } of parents.reverse()) {
    const replacements: ProseMirrorNode[] = []
    for (let i = 0; i < node.childCount; ) {
      const child = node.child(i)
      if (!child.isText) {
        replacements.push(child)
        i++
        continue
      }
      const text = [child]
      i++
      while (i < node.childCount) {
        const next = node.child(i)
        if (!next.isText || !sameMarks(child.marks, next.marks)) break
        text.push(next)
        i++
      }
      replacements.push(
        documentBodySchema.nodes.run!.create(
          { nodeID: null, bodyAttributes: '{}', bodyContent: '' },
          text
        )
      )
    }
    transaction.replaceWith(
      position + 1,
      position + node.nodeSize - 1,
      replacements
    )
  }
}

function splitRunsWithMixedMarks(transaction: Transaction) {
  const mixedRuns: { node: ProseMirrorNode; position: number }[] = []
  transaction.doc.descendants((node, position) => {
    if (node.type === documentBodySchema.nodes.run) {
      if (!hasUniformMarks(node)) mixedRuns.push({ node, position })
      return false
    }
    return true
  })

  for (const { node, position } of mixedRuns.reverse()) {
    const groups: ProseMirrorNode[][] = []
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      const current = groups.at(-1)
      if (current && sameMarks(current[0]!.marks, child.marks))
        current.push(child)
      else groups.push([child])
    }
    const replacements = groups.map((children, index) =>
      node.type.create(
        {
          ...node.attrs,
          nodeID: index === 0 ? node.attrs.nodeID : null,
        },
        children,
        node.marks
      )
    )
    transaction.replaceWith(position, position + node.nodeSize, replacements)
  }
}

function hasUniformMarks(node: ProseMirrorNode) {
  if (node.childCount < 2) return true
  const marks = node.child(0).marks
  for (let i = 1; i < node.childCount; i++)
    if (!sameMarks(marks, node.child(i).marks)) return false
  return true
}

function sameMarks(
  left: ProseMirrorNode['marks'],
  right: ProseMirrorNode['marks']
) {
  return (
    left.length === right.length &&
    left.every((mark, index) => mark.eq(right[index]!))
  )
}

function assignNodeIDs(transaction: Transaction) {
  const seen = new Set<string>()
  const missingOrDuplicate: number[] = []
  transaction.doc.descendants((node, position) => {
    if (node.isText) return true
    const nodeID = node.attrs.nodeID
    if (typeof nodeID !== 'string' || !nodeID || seen.has(nodeID))
      missingOrDuplicate.push(position)
    else seen.add(nodeID)
    return true
  })

  for (const position of missingOrDuplicate.reverse()) {
    const node = transaction.doc.nodeAt(position)
    if (!node) throw new Error('cannot assign an ID to a missing node')
    let nodeID = crypto.randomUUID()
    while (seen.has(nodeID)) nodeID = crypto.randomUUID()
    seen.add(nodeID)
    transaction.setNodeMarkup(position, undefined, { ...node.attrs, nodeID })
  }
}

function reassignChildrenMovedFromDeletedParents(
  transaction: Transaction,
  before: DocumentBodyNode[],
  after: DocumentBodyNode[],
  authorizedMoveNodeIDs: ReadonlySet<string>
) {
  const oldNodes = new Map(before.map((node) => [node.nodeID, node]))
  const newNodes = new Map(after.map((node) => [node.nodeID, node]))
  const deletedParentIDs = new Set(
    before
      .filter((node) => !newNodes.has(node.nodeID))
      .map((node) => node.nodeID)
  )
  const reassign = new Set<string>()
  for (const node of after) {
    const oldNode = oldNodes.get(node.nodeID)
    if (
      oldNode?.parentID !== null &&
      oldNode?.parentID !== undefined &&
      deletedParentIDs.has(oldNode.parentID) &&
      node.parentID !== oldNode.parentID &&
      !authorizedMoveNodeIDs.has(node.nodeID)
    )
      reassign.add(node.nodeID)
  }
  if (!reassign.size) return

  const seen = new Set(after.map((node) => node.nodeID))
  const positions: number[] = []
  transaction.doc.descendants((node, position) => {
    if (reassign.has(node.attrs.nodeID)) positions.push(position)
    return true
  })
  for (const position of positions.reverse()) {
    const node = transaction.doc.nodeAt(position)
    if (!node) throw new Error('cannot reidentify a missing node')
    seen.delete(node.attrs.nodeID)
    let nodeID = crypto.randomUUID()
    while (seen.has(nodeID)) nodeID = crypto.randomUUID()
    seen.add(nodeID)
    transaction.setNodeMarkup(position, undefined, { ...node.attrs, nodeID })
  }
}

function validateOpaquePreservation(
  before: DocumentBodyNode[],
  after: DocumentBodyNode[]
) {
  const oldNodes = new Map(before.map((node) => [node.nodeID, node]))
  const newNodes = new Map(after.map((node) => [node.nodeID, node]))
  const oldChildren = indexByParent(before)
  for (const oldNode of before) {
    if (oldNode.type !== 'opaque' && oldNode.type !== 'opaque-inline') continue
    const newNode = newNodes.get(oldNode.nodeID)
    if (
      !newNode ||
      newNode.type !== oldNode.type ||
      newNode.content !== oldNode.content ||
      JSON.stringify(newNode.attributes) !== JSON.stringify(oldNode.attributes)
    )
      throw new Error(
        `opaque node ${oldNode.nodeID} cannot be changed or removed`
      )

    let oldParentID = oldNode.parentID
    let newParentID = newNode.parentID
    while (oldParentID !== null || newParentID !== null) {
      if (oldParentID !== newParentID)
        throw new Error(`opaque node ${oldNode.nodeID} cannot be moved`)
      const oldParent = oldNodes.get(oldParentID!)
      const newParent = newNodes.get(newParentID!)
      if (!oldParent || !newParent || oldParent.type !== newParent.type)
        throw new Error(`opaque node ${oldNode.nodeID} cannot be moved`)
      if (
        relativeOrderChanged(oldParent.nodeID, oldNodes, newNodes, oldChildren)
      )
        throw new Error(`opaque node ${oldNode.nodeID} cannot be reordered`)
      oldParentID = oldParent.parentID
      newParentID = newParent.parentID
    }
    if (relativeOrderChanged(oldNode.nodeID, oldNodes, newNodes, oldChildren))
      throw new Error(`opaque node ${oldNode.nodeID} cannot be reordered`)
  }
}

function relativeOrderChanged(
  nodeID: string,
  oldNodes: ReadonlyMap<string, DocumentBodyNode>,
  newNodes: ReadonlyMap<string, DocumentBodyNode>,
  oldChildren: ReadonlyMap<string | null, DocumentBodyNode[]>
) {
  const oldNode = oldNodes.get(nodeID)!
  const newNode = newNodes.get(nodeID)
  if (!newNode || oldNode.parentID !== newNode.parentID) return true
  for (const oldSibling of oldChildren.get(oldNode.parentID) ?? []) {
    if (oldSibling.nodeID === nodeID) continue
    const newSibling = newNodes.get(oldSibling.nodeID)
    if (
      newSibling?.parentID === newNode.parentID &&
      Math.sign(oldNode.siblingOrder - oldSibling.siblingOrder) !==
        Math.sign(newNode.siblingOrder - newSibling.siblingOrder)
    )
      return true
  }
  return false
}

function validateStructuralChanges(
  before: DocumentBodyNode[],
  after: DocumentBodyNode[],
  authorizedMoveNodeIDs: ReadonlySet<string>
) {
  const newNodes = new Map(after.map((node) => [node.nodeID, node]))
  const oldChildrenByParent = indexByParent(before)
  const newChildrenByParent = indexByParent(after)
  for (const oldNode of before) {
    const newNode = newNodes.get(oldNode.nodeID)
    if (
      newNode &&
      oldNode.parentID !== newNode.parentID &&
      !authorizedMoveNodeIDs.has(oldNode.nodeID)
    )
      throw new Error(`moving node ${oldNode.nodeID} requires MoveNode`)
  }

  for (const [parentID, siblings] of oldChildrenByParent) {
    const oldOrder = siblings
      .filter(
        (node) =>
          newNodes.get(node.nodeID)?.parentID === parentID &&
          !authorizedMoveNodeIDs.has(node.nodeID)
      )
      .sort((left, right) => left.siblingOrder - right.siblingOrder)
      .map((node) => node.nodeID)
    const oldIDs = new Set(oldOrder)
    const newOrder = (newChildrenByParent.get(parentID) ?? [])
      .filter((node) => oldIDs.has(node.nodeID))
      .sort((left, right) => left.siblingOrder - right.siblingOrder)
      .map((node) => node.nodeID)
    if (oldOrder.some((nodeID, index) => nodeID !== newOrder[index]))
      throw new Error(`reordering children of ${parentID} requires MoveNode`)
  }
}

function indexByParent(nodes: DocumentBodyNode[]) {
  const children = new Map<string | null, DocumentBodyNode[]>()
  for (const node of nodes) {
    const siblings = children.get(node.parentID) ?? []
    siblings.push(node)
    children.set(node.parentID, siblings)
  }
  return children
}
