import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror'
import * as Y from 'yjs'
import type { MarkdownBodySnapshot } from '@/lib/domain-api'
import { encodeBase64 } from './collaboration-socket'
import {
  IndexedDBCollaborationStore,
  type CollaborationScope,
  type PendingDeleteNodeCommand,
  type PendingMoveNodeCommand,
} from './collaboration-store'
import type { DocumentBodyNode } from './documentBody'
import { documentBodyToMarkdown } from './muya/state/documentBodyToMarkdown'
import {
  documentBodySchema,
  prosemirrorToDocumentBody,
} from './prosemirror/documentBody'

export function projectEncodedState(state: Uint8Array): DocumentBodyNode[] {
  const document = new Y.Doc()
  try {
    Y.applyUpdate(document, state)
    return prosemirrorToDocumentBody(
      yXmlFragmentToProseMirrorRootNode(
        document.getXmlFragment('body'),
        documentBodySchema
      )
    )
  } finally {
    document.destroy()
  }
}

/** The snapshot with pending Yjs updates applied; structural commands excluded. */
export function pendingBodyNodes(stored: {
  snapshot: { encodedState: Uint8Array } | null
  updates: { update: Uint8Array }[]
}): DocumentBodyNode[] {
  if (!stored.snapshot) return []
  const document = new Y.Doc()
  try {
    Y.applyUpdate(document, stored.snapshot.encodedState)
    for (const update of stored.updates) Y.applyUpdate(document, update.update)
    return prosemirrorToDocumentBody(
      yXmlFragmentToProseMirrorRootNode(
        document.getXmlFragment('body'),
        documentBodySchema
      )
    )
  } finally {
    document.destroy()
  }
}

export async function recoverPendingMarkdown(scope: CollaborationScope) {
  const stored = await new IndexedDBCollaborationStore().load(scope)
  if (
    !stored.snapshot ||
    (!stored.updates.length &&
      !stored.deleteCommands.length &&
      !stored.moveCommands.length)
  )
    return null
  if (stored.deleteCommands.length + stored.moveCommands.length > 1)
    throw new Error('multiple structural commands need separate review')

  const document = new Y.Doc()
  try {
    Y.applyUpdate(document, stored.snapshot.encodedState)
    for (const update of stored.updates) Y.applyUpdate(document, update.update)
    const root = yXmlFragmentToProseMirrorRootNode(
      document.getXmlFragment('body'),
      documentBodySchema
    )
    const nodes = prosemirrorToDocumentBody(root)
    return documentBodyToMarkdown(
      applyDeleteCommands(
        applyMoveCommands(nodes, stored.moveCommands),
        stored.deleteCommands
      )
    )
  } finally {
    document.destroy()
  }
}

function applyMoveCommands(
  nodes: DocumentBodyNode[],
  commands: PendingMoveNodeCommand[]
) {
  if (!commands.length) return nodes
  const byID = new Map(nodes.map((node) => [node.nodeID, { ...node }]))
  const children = new Map<string, string[]>()
  for (const node of nodes) {
    if (node.parentID === null) continue
    const siblings = children.get(node.parentID) ?? []
    siblings.push(node.nodeID)
    children.set(node.parentID, siblings)
  }
  for (const siblingIDs of children.values())
    siblingIDs.sort(
      (left, right) =>
        byID.get(left)!.siblingOrder - byID.get(right)!.siblingOrder
    )

  for (const command of commands) {
    const node = byID.get(command.nodeID)
    const targetParent = byID.get(command.targetParentID)
    if (!node || !targetParent || node.parentID === null)
      throw new Error('pending MoveNode cannot be projected onto local body')
    let ancestor: DocumentBodyNode | undefined = targetParent
    while (ancestor) {
      if (ancestor.nodeID === node.nodeID)
        throw new Error('pending MoveNode would create a cycle')
      ancestor = ancestor.parentID ? byID.get(ancestor.parentID) : undefined
    }

    const source = children.get(node.parentID)
    if (!source || !source.includes(node.nodeID))
      throw new Error('pending MoveNode source is missing from local body')
    source.splice(source.indexOf(node.nodeID), 1)
    const target = children.get(command.targetParentID) ?? []
    if (command.beforeNodeID !== null) {
      const index = target.indexOf(command.beforeNodeID)
      if (index < 0)
        throw new Error('pending MoveNode target is missing from local body')
      target.splice(index, 0, node.nodeID)
    } else target.push(node.nodeID)
    node.parentID = command.targetParentID
    children.set(command.targetParentID, target)
    source.forEach((nodeID, index) => {
      byID.get(nodeID)!.siblingOrder = index
    })
    target.forEach((nodeID, index) => {
      byID.get(nodeID)!.siblingOrder = index
    })
  }
  return nodes.map((node) => byID.get(node.nodeID)!)
}

function applyDeleteCommands(
  nodes: DocumentBodyNode[],
  commands: PendingDeleteNodeCommand[]
) {
  const children = new Map<string, string[]>()
  for (const node of nodes) {
    if (node.parentID === null) continue
    const siblings = children.get(node.parentID) ?? []
    siblings.push(node.nodeID)
    children.set(node.parentID, siblings)
  }
  const deleted = new Set<string>()
  for (const { nodeID } of commands) {
    const pending = [nodeID]
    while (pending.length) {
      const current = pending.pop()!
      if (deleted.has(current)) continue
      deleted.add(current)
      pending.push(...(children.get(current) ?? []))
    }
  }
  return nodes.filter((node) => !deleted.has(node.nodeID))
}

export async function clearLocalMarkdown(scope: CollaborationScope) {
  await new IndexedDBCollaborationStore().clear(scope)
}

export async function loadOfflineMarkdownBody(
  scope: CollaborationScope
): Promise<MarkdownBodySnapshot | null> {
  const { snapshot } = await new IndexedDBCollaborationStore().load(scope)
  if (!snapshot || snapshot.bodySchemaVersion !== 1) return null

  const document = new Y.Doc()
  try {
    Y.applyUpdate(document, snapshot.encodedState)
    const root = yXmlFragmentToProseMirrorRootNode(
      document.getXmlFragment('body'),
      documentBodySchema
    )
    const nodes = prosemirrorToDocumentBody(root)
    const rootNode = nodes.find((node) => node.parentID === null)
    if (!rootNode || rootNode.type !== 'document') return null
    return {
      bodyVersion: snapshot.bodyVersion,
      bodyEpoch: snapshot.bodyEpoch,
      bodySchemaVersion: snapshot.bodySchemaVersion,
      canEdit: snapshot.canEdit === true,
      rootNodeID: rootNode.nodeID,
      nodes: nodes.map((node) => ({ ...node, version: 1 })),
      encodedState: encodeBase64(snapshot.encodedState),
    }
  } catch {
    return null
  } finally {
    document.destroy()
  }
}
