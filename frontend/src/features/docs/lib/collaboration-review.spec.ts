import { describe, expect, it } from 'vitest'
import type { MarkdownBodySnapshot } from '@/lib/domain-api'
import {
  diffForReview,
  explainStructuralHold,
  resolveHeldCommand,
} from './collaboration-review'
import {
  IndexedDBCollaborationStore,
  type PendingDeleteNodeCommand,
  type PendingMoveNodeCommand,
} from './collaboration-store'
import type { DocumentBodyNode } from './documentBody'

function node(
  nodeID: string,
  parentID: string | null,
  siblingOrder: number,
  type: string,
  content = ''
): DocumentBodyNode {
  return { nodeID, parentID, siblingOrder, type, content, attributes: {} }
}

const body = (): DocumentBodyNode[] => [
  node('root', null, 1, 'document'),
  node('p1', 'root', 1, 'paragraph'),
  node('r1', 'p1', 1, 'run', 'hello'),
  node('p2', 'root', 2, 'paragraph'),
  node('r2', 'p2', 1, 'run', 'second'),
]

describe('diffForReview', () => {
  it('lists edited, added, and removed text, and ignores empty containers', () => {
    const local = [
      ...body().map((n) =>
        n.nodeID === 'r1' ? { ...n, content: 'hello there' } : n
      ),
      node('p3', 'root', 3, 'paragraph'),
      node('r3', 'p3', 1, 'run', 'brand new'),
    ].filter((n) => n.nodeID !== 'r2' && n.nodeID !== 'p2')
    expect(diffForReview(local, body())).toEqual([
      {
        nodeID: 'r1',
        type: 'run',
        kind: 'edited',
        local: 'hello there',
        canonical: 'hello',
      },
      {
        nodeID: 'r3',
        type: 'run',
        kind: 'added',
        local: 'brand new',
        canonical: null,
      },
      {
        nodeID: 'r2',
        type: 'run',
        kind: 'removed',
        local: null,
        canonical: 'second',
      },
    ])
  })

  it('returns nothing when both bodies match', () => {
    expect(diffForReview(body(), body())).toEqual([])
  })
})

const deleteCommand = (nodeID: string): PendingDeleteNodeCommand => ({
  commandID: 'c1',
  bodyEpoch: 1,
  bodySchemaVersion: 1,
  nodeID,
})
const moveCommand = (
  nodeID: string,
  targetParentID: string,
  beforeNodeID: string | null = null
): PendingMoveNodeCommand => ({
  commandID: 'm1',
  bodyEpoch: 1,
  bodySchemaVersion: 1,
  nodeID,
  targetParentID,
  beforeNodeID,
})

describe('explainStructuralHold', () => {
  it('says a delete was held because the block gained content', () => {
    const current = body().map((n) =>
      n.nodeID === 'r2' ? { ...n, content: 'second and more' } : n
    )
    expect(
      explainStructuralHold({
        kind: 'delete',
        command: deleteCommand('p2'),
        current,
        seen: body(),
      })
    ).toMatchObject({ code: 'content-changed', canForce: true })
  })

  it('does not offer to force a delete of the root', () => {
    expect(
      explainStructuralHold({
        kind: 'delete',
        command: deleteCommand('root'),
        current: body(),
        seen: body(),
      })
    ).toMatchObject({ code: 'root', canForce: false })
  })

  it('explains each way a move can lose its anchor', () => {
    const current = body()
    const explain = (command: PendingMoveNodeCommand, nodes = current) =>
      explainStructuralHold({
        kind: 'move',
        command,
        current: nodes,
        seen: body(),
      }).code
    expect(explain(moveCommand('p2', 'gone'))).toBe('target-missing')
    expect(explain(moveCommand('gone', 'p1'))).toBe('node-missing')
    expect(explain(moveCommand('p1', 'r1'))).toBe('target-inside-node')
    expect(explain(moveCommand('p2', 'root', 'gone'))).toBe('before-missing')
  })

  it('never offers force for a move', () => {
    expect(
      explainStructuralHold({
        kind: 'move',
        command: moveCommand('p2', 'gone'),
        current: body(),
        seen: body(),
      }).canForce
    ).toBe(false)
  })
})

function canonical(
  nodes: DocumentBodyNode[],
  epoch: number
): MarkdownBodySnapshot {
  return {
    bodyVersion: epoch,
    bodyEpoch: epoch,
    bodySchemaVersion: 1,
    canEdit: true,
    rootNodeID: 'root',
    nodes: nodes.map((n) => ({ ...n, version: 1 })),
    encodedState: btoa('x'),
  } as MarkdownBodySnapshot
}

async function seedStore(
  command: PendingDeleteNodeCommand | PendingMoveNodeCommand,
  kind: 'delete' | 'move'
) {
  const scope = { userID: crypto.randomUUID(), documentID: crypto.randomUUID() }
  const store = new IndexedDBCollaborationStore()
  const snapshot = {
    bodyVersion: 1,
    bodyEpoch: 1,
    bodySchemaVersion: 1,
    canEdit: true,
    encodedState: new Uint8Array([1]),
  }
  if (kind === 'delete')
    await store.saveDeleteCommand(
      scope,
      snapshot,
      command as PendingDeleteNodeCommand
    )
  else
    await store.saveMoveCommand(
      scope,
      snapshot,
      command as PendingMoveNodeCommand
    )
  return { scope, store }
}

describe('resolveHeldCommand', () => {
  it('delete anyway re-issues the delete at the current epoch under a new ID, then clears the hold', async () => {
    const { scope, store } = await seedStore(deleteCommand('p2'), 'delete')
    const current = canonical(body(), 3)
    const sent: PendingDeleteNodeCommand[] = []
    const result = await resolveHeldCommand({
      scope,
      store,
      kind: 'delete',
      commandID: 'c1',
      choice: 'force',
      fetchBody: async () => current,
      executeDelete: async (command) => {
        sent.push(command)
        return canonical(
          body().filter((n) => n.nodeID !== 'p2' && n.nodeID !== 'r2'),
          4
        )
      },
      executeMove: async () => {
        throw new Error('unused')
      },
    })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      nodeID: 'p2',
      bodyEpoch: 3,
      bodySchemaVersion: 1,
    })
    expect(sent[0]!.commandID).not.toBe('c1')
    expect(result.bodyEpoch).toBe(4)
    const stored = await store.load(scope)
    expect(stored.deleteCommands).toEqual([])
    expect(stored.snapshot?.bodyEpoch).toBe(4)
  })

  it('cancel drops the command without calling the server and adopts the current body', async () => {
    const { scope, store } = await seedStore(moveCommand('p2', 'gone'), 'move')
    const result = await resolveHeldCommand({
      scope,
      store,
      kind: 'move',
      commandID: 'm1',
      choice: 'cancel',
      fetchBody: async () => canonical(body(), 3),
      executeDelete: async () => {
        throw new Error('must not call')
      },
      executeMove: async () => {
        throw new Error('must not call')
      },
    })
    expect(result.bodyEpoch).toBe(3)
    const stored = await store.load(scope)
    expect(stored.moveCommands).toEqual([])
    expect(stored.snapshot?.bodyEpoch).toBe(3)
  })

  it('keeps the command when forcing fails', async () => {
    const { scope, store } = await seedStore(deleteCommand('p2'), 'delete')
    await expect(
      resolveHeldCommand({
        scope,
        store,
        kind: 'delete',
        commandID: 'c1',
        choice: 'force',
        fetchBody: async () => canonical(body(), 3),
        executeDelete: async () => {
          throw new Error('network')
        },
        executeMove: async () => {
          throw new Error('unused')
        },
      })
    ).rejects.toThrow('network')
    expect((await store.load(scope)).deleteCommands).toHaveLength(1)
  })
})
