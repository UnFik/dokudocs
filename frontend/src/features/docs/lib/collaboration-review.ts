import * as Y from 'yjs'
import type { MarkdownBodySnapshot } from '@/lib/domain-api'
import type { HeldEdit } from './collaboration-rebase'
import { buildRebaseUpdate } from './collaboration-rebase-yjs'
import { pendingBodyNodes, projectEncodedState } from './collaboration-recovery'
import { decodeBase64 } from './collaboration-socket'
import {
  type CollaborationScope,
  type CollaborationSnapshot,
  type CollaborationStore,
  type PendingDeleteNodeCommand,
  type PendingMoveNodeCommand,
} from './collaboration-store'
import type { DocumentBodyNode } from './documentBody'

export type ReviewItem = {
  nodeID: string
  type: string
  kind: 'edited' | 'added' | 'removed'
  local: string | null
  canonical: string | null
}

/**
 * Text-level comparison of the user's pending body against the server body,
 * keyed by node ID. Containers with no text of their own are left out so the
 * list shows what a person can read and copy.
 */
export function diffForReview(
  local: DocumentBodyNode[],
  canonical: DocumentBodyNode[]
): ReviewItem[] {
  const canonicalByID = new Map(canonical.map((n) => [n.nodeID, n]))
  const localIDs = new Set(local.map((n) => n.nodeID))
  const items: ReviewItem[] = []
  for (const node of local) {
    const other = canonicalByID.get(node.nodeID)
    if (!other) {
      if (node.content)
        items.push({
          nodeID: node.nodeID,
          type: node.type,
          kind: 'added',
          local: node.content,
          canonical: null,
        })
    } else if (other.content !== node.content)
      items.push({
        nodeID: node.nodeID,
        type: node.type,
        kind: 'edited',
        local: node.content,
        canonical: other.content,
      })
  }
  for (const node of canonical)
    if (!localIDs.has(node.nodeID) && node.content)
      items.push({
        nodeID: node.nodeID,
        type: node.type,
        kind: 'removed',
        local: null,
        canonical: node.content,
      })
  return items
}

export type HoldCode =
  | 'content-changed'
  | 'root'
  | 'node-missing'
  | 'target-missing'
  | 'target-inside-node'
  | 'before-missing'
  | 'unknown'

export type HoldExplanation = {
  code: HoldCode
  message: string
  /** Only a delete of a changed block can be pushed through on purpose. */
  canForce: boolean
  /** A move that can still be sent, possibly with a changed position. */
  canReissue: boolean
}

export function explainStructuralHold(
  input:
    | {
        kind: 'delete'
        command: PendingDeleteNodeCommand
        current: DocumentBodyNode[]
        seen: DocumentBodyNode[]
      }
    | {
        kind: 'move'
        command: PendingMoveNodeCommand
        current: DocumentBodyNode[]
        seen: DocumentBodyNode[]
      }
): HoldExplanation {
  const byID = new Map(input.current.map((n) => [n.nodeID, n]))
  const hold = (
    code: HoldCode,
    message: string,
    canForce = false,
    canReissue = false
  ): HoldExplanation => ({ code, message, canForce, canReissue })

  if (input.kind === 'delete') {
    const node = byID.get(input.command.nodeID)
    if (node?.parentID === null)
      return hold('root', 'The document root cannot be deleted.')
    if (node)
      return hold(
        'content-changed',
        'This block changed on the server after you deleted it. Deleting it now would remove text you have not seen.',
        true
      )
    return hold('unknown', 'This deletion could not be checked.')
  }

  const { command } = input
  const node = byID.get(command.nodeID)
  if (!node || node.parentID === null)
    return hold(
      'node-missing',
      'The block you moved was deleted on the server.'
    )
  const target = byID.get(command.targetParentID)
  if (!target)
    return hold(
      'target-missing',
      'The place you moved this block to no longer exists.'
    )
  for (
    let ancestor: DocumentBodyNode | undefined = target;
    ancestor;
    ancestor = ancestor.parentID ? byID.get(ancestor.parentID) : undefined
  )
    if (ancestor.nodeID === node.nodeID)
      return hold(
        'target-inside-node',
        'The new place is now inside the block you moved.'
      )
  if (command.beforeNodeID != null) {
    const before = byID.get(command.beforeNodeID)
    if (!before || before.parentID !== command.targetParentID)
      return hold(
        'before-missing',
        'The block you placed it before was moved or deleted.',
        false,
        true
      )
  }
  return hold(
    'unknown',
    'This move was held, but it still fits the current document.',
    false,
    true
  )
}

function toSnapshot(body: MarkdownBodySnapshot): CollaborationSnapshot {
  return {
    bodyVersion: body.bodyVersion,
    bodyEpoch: body.bodyEpoch,
    bodySchemaVersion: body.bodySchemaVersion,
    canEdit: body.canEdit,
    encodedState: decodeBase64(body.encodedState),
  }
}

/**
 * Settles a structural command that was held for review. `cancel` drops it and
 * adopts the current server body. `force` (delete only) sends the delete again
 * at the current epoch under a new ID, which is the owner's explicit choice.
 * The held command is removed only after the server accepted the replacement.
 */
export async function resolveHeldCommand(input: {
  scope: CollaborationScope
  store: CollaborationStore
  kind: 'delete' | 'move'
  commandID: string
  choice: 'force' | 'reissue' | 'cancel'
  fetchBody: () => Promise<MarkdownBodySnapshot>
  executeDelete: (
    command: PendingDeleteNodeCommand
  ) => Promise<MarkdownBodySnapshot>
  executeMove: (
    command: PendingMoveNodeCommand
  ) => Promise<MarkdownBodySnapshot>
}): Promise<MarkdownBodySnapshot> {
  const complete = (body: MarkdownBodySnapshot) =>
    input.kind === 'delete'
      ? input.store.completeDeleteCommand(
          input.scope,
          input.commandID,
          toSnapshot(body)
        )
      : input.store.completeMoveCommand(
          input.scope,
          input.commandID,
          toSnapshot(body)
        )

  const current = await input.fetchBody()
  if (input.choice === 'cancel') {
    await complete(current)
    return current
  }

  if (input.choice === 'reissue') {
    if (input.kind !== 'move')
      throw new Error('only a held move can be re-issued')
    const stored = (await input.store.load(input.scope)).moveCommands.find(
      (command) => command.commandID === input.commandID
    )
    if (!stored) throw new Error('held move command not found')
    const explanation = explainStructuralHold({
      kind: 'move',
      command: stored,
      current: current.nodes as DocumentBodyNode[],
      seen: [],
    })
    if (!explanation.canReissue)
      throw new Error('This move cannot be re-issued: ' + explanation.message)
    const result = await input.executeMove({
      ...stored,
      commandID: crypto.randomUUID(),
      bodyEpoch: current.bodyEpoch,
      bodySchemaVersion: current.bodySchemaVersion,
      beforeNodeID:
        explanation.code === 'before-missing' ? null : stored.beforeNodeID,
    })
    await complete(result)
    return result
  }

  if (input.kind !== 'delete')
    throw new Error('only a held delete can be forced')
  const held = (await input.store.load(input.scope)).deleteCommands.find(
    (command) => command.commandID === input.commandID
  )
  if (!held) throw new Error('held delete command not found')
  const result = await input.executeDelete({
    ...held,
    commandID: crypto.randomUUID(),
    bodyEpoch: current.bodyEpoch,
    bodySchemaVersion: current.bodySchemaVersion,
  })
  await complete(result)
  return result
}

export type ReviewCommand = {
  kind: 'delete' | 'move'
  commandID: string
  nodeID: string
  explanation: HoldExplanation
}

export type ReviewModel = {
  canEdit: boolean
  held: HeldEdit[]
  commands: ReviewCommand[]
  pendingDiff: ReviewItem[]
}

/**
 * Everything the review screen shows, read from the device store and compared
 * with the current server body. `canEdit` comes from that same fetch, so copy
 * is offered only with edit rights as they are now.
 */
export async function loadReviewModel(input: {
  scope: CollaborationScope
  store: CollaborationStore
  fetchBody: () => Promise<MarkdownBodySnapshot>
}): Promise<ReviewModel> {
  const stored = await input.store.load(input.scope)
  const current = await input.fetchBody()
  const seen = stored.snapshot
    ? projectEncodedState(stored.snapshot.encodedState)
    : []
  const nodes = current.nodes as DocumentBodyNode[]
  const commands: ReviewCommand[] = [
    ...stored.deleteCommands.map((command) => ({
      kind: 'delete' as const,
      commandID: command.commandID,
      nodeID: command.nodeID,
      explanation: explainStructuralHold({
        kind: 'delete',
        command,
        current: nodes,
        seen,
      }),
    })),
    ...stored.moveCommands.map((command) => ({
      kind: 'move' as const,
      commandID: command.commandID,
      nodeID: command.nodeID,
      explanation: explainStructuralHold({
        kind: 'move',
        command,
        current: nodes,
        seen,
      }),
    })),
  ]
  return {
    canEdit: current.canEdit,
    held: stored.heldEdits,
    commands,
    pendingDiff: stored.updates.length
      ? diffForReview(pendingBodyNodes(stored), nodes)
      : [],
  }
}

/**
 * "Use my version": writes the held local text back as a new pending edit on
 * top of the stored state, so it syncs like any other edit. It needs edit
 * rights as they are now and the same epoch the device state was built on.
 */
export async function acceptHeldEdit(input: {
  scope: CollaborationScope
  store: CollaborationStore
  nodeID: string
  fetchBody: () => Promise<MarkdownBodySnapshot>
}): Promise<void> {
  const body = await input.fetchBody()
  if (!body.canEdit)
    throw new Error(
      'You no longer have edit access, so your version cannot be applied.'
    )
  const stored = await input.store.load(input.scope)
  const { snapshot } = stored
  if (!snapshot || snapshot.bodyEpoch !== body.bodyEpoch)
    throw new Error(
      'The document changed again. Reopen it to review the new comparison.'
    )
  const edit = stored.heldEdits.find((held) => held.nodeID === input.nodeID)
  if (!edit) throw new Error('That edit is no longer held.')
  const nodes = projectEncodedState(snapshot.encodedState)
  if (!nodes.some((candidate) => candidate.nodeID === input.nodeID))
    throw new Error(
      'That block no longer exists, so your version cannot be applied.'
    )
  const update = buildRebaseUpdate(
    snapshot.encodedState,
    nodes.map((candidate) =>
      candidate.nodeID === input.nodeID
        ? { ...candidate, content: edit.local.content }
        : candidate
    )
  )
  await input.store.saveUpdate(
    input.scope,
    {
      ...snapshot,
      encodedState: Y.mergeUpdates([snapshot.encodedState, update]),
    },
    {
      updateID: crypto.randomUUID(),
      bodyEpoch: body.bodyEpoch,
      bodySchemaVersion: body.bodySchemaVersion,
      update,
    }
  )
  await input.store.setHeldEdits(
    input.scope,
    stored.heldEdits.filter((held) => held.nodeID !== input.nodeID)
  )
}
