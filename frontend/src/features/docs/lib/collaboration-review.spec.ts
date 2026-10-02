import { describe, expect, it } from 'vitest'
import { prosemirrorToYXmlFragment } from 'y-prosemirror'
import * as Y from 'yjs'
import type { MarkdownBodySnapshot } from '@/lib/domain-api'
import { projectEncodedState } from './collaboration-recovery'
import {
  diffForReview,
  acceptHeldEdit,
  explainStructuralHold,
  loadReviewModel,
  resolveHeldCommand,
} from './collaboration-review'
import {
  IndexedDBCollaborationStore,
  type PendingDeleteNodeCommand,
  type PendingMoveNodeCommand,
} from './collaboration-store'
import type { DocumentBodyNode } from './documentBody'
import { documentBodyToProseMirror } from './prosemirror/documentBody'

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
  nodeIDs: [nodeID],
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
    encodedState: stateOf(body()),
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
      nodeIDs: ['p2'],
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

function stateOf(nodes: DocumentBodyNode[]) {
  const doc = new Y.Doc()
  prosemirrorToYXmlFragment(
    documentBodyToProseMirror(nodes),
    doc.getXmlFragment('body')
  )
  return Y.encodeStateAsUpdate(doc)
}

describe('loadReviewModel', () => {
  it('collects held edits and explains a held structural command against the current body', async () => {
    const { scope, store } = await seedStore(deleteCommand('p2'), 'delete')
    await store.replaceWithRebased(
      scope,
      {
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        encodedState: stateOf(body()),
      },
      {
        updateID: 'u1',
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        update: Y.encodeStateAsUpdate(new Y.Doc()),
      },
      [
        {
          nodeID: 'r1',
          reason: 'concurrent-edit',
          local: node('r1', 'p1', 1, 'run', 'mine'),
          canonical: node('r1', 'p1', 1, 'run', 'theirs'),
        },
      ]
    )
    const current = body().map((n) =>
      n.nodeID === 'r2' ? { ...n, content: 'second and more' } : n
    )
    const model = await loadReviewModel({
      scope,
      store,
      fetchBody: async () => canonical(current, 3),
    })
    expect(model.canEdit).toBe(true)
    expect(model.held.map((h) => h.nodeID)).toEqual(['r1'])
    expect(model.commands).toMatchObject([
      {
        kind: 'delete',
        commandID: 'c1',
        explanation: { code: 'content-changed' },
      },
    ])
    expect(model.pendingDiff).toEqual([
      {
        nodeID: 'r2',
        type: 'run',
        kind: 'edited',
        local: 'second',
        canonical: 'second and more',
      },
    ])
  })

  it('leaves out the pending text diff when it is not asked for', async () => {
    const { scope, store } = await seedStore(deleteCommand('p2'), 'delete')
    await store.saveUpdate(
      scope,
      {
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        encodedState: stateOf(body()),
      },
      {
        updateID: 'u1',
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        update: Y.encodeStateAsUpdate(new Y.Doc()),
      }
    )
    const current = body().map((n) =>
      n.nodeID === 'r2' ? { ...n, content: 'changed' } : n
    )
    const model = await loadReviewModel({
      scope,
      store,
      includePendingDiff: false,
      fetchBody: async () => canonical(current, 1),
    })
    expect(model.pendingDiff).toEqual([])
  })

  it('reports no edit access when the server says so', async () => {
    const { scope, store } = await seedStore(deleteCommand('p2'), 'delete')
    const model = await loadReviewModel({
      scope,
      store,
      fetchBody: async () => ({ ...canonical(body(), 3), canEdit: false }),
    })
    expect(model.canEdit).toBe(false)
  })
})

describe('move re-issue', () => {
  it('offers re-issue only when the move can still be applied', () => {
    const explain = (command: PendingMoveNodeCommand) =>
      explainStructuralHold({
        kind: 'move',
        command,
        current: body(),
        seen: body(),
      })
    expect(explain(moveCommand('p2', 'root', 'gone'))).toMatchObject({
      code: 'before-missing',
      canReissue: true,
    })
    expect(explain(moveCommand('p2', 'gone')).canReissue).toBe(false)
    expect(explain(moveCommand('gone', 'p1')).canReissue).toBe(false)
  })

  it('re-issues a move whose neighbour vanished to the end of the target, under a new ID at the current epoch', async () => {
    const { scope, store } = await seedStore(
      moveCommand('p2', 'root', 'gone'),
      'move'
    )
    const sent: PendingMoveNodeCommand[] = []
    const result = await resolveHeldCommand({
      scope,
      store,
      kind: 'move',
      commandID: 'm1',
      choice: 'reissue',
      fetchBody: async () => canonical(body(), 3),
      executeDelete: async () => {
        throw new Error('unused')
      },
      executeMove: async (command) => {
        sent.push(command)
        return canonical(body(), 4)
      },
    })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      nodeID: 'p2',
      targetParentID: 'root',
      beforeNodeID: null,
      bodyEpoch: 3,
    })
    expect(sent[0]!.commandID).not.toBe('m1')
    expect(result.bodyEpoch).toBe(4)
    expect((await store.load(scope)).moveCommands).toEqual([])
  })

  it('refuses to re-issue a move whose target is gone and keeps it held', async () => {
    const { scope, store } = await seedStore(moveCommand('p2', 'gone'), 'move')
    await expect(
      resolveHeldCommand({
        scope,
        store,
        kind: 'move',
        commandID: 'm1',
        choice: 'reissue',
        fetchBody: async () => canonical(body(), 3),
        executeDelete: async () => {
          throw new Error('unused')
        },
        executeMove: async () => {
          throw new Error('must not call')
        },
      })
    ).rejects.toThrow(/cannot be re-issued/)
    expect((await store.load(scope)).moveCommands).toHaveLength(1)
  })
})

describe('acceptHeldEdit', () => {
  async function seedHeld() {
    const scope = {
      userID: crypto.randomUUID(),
      documentID: crypto.randomUUID(),
    }
    const store = new IndexedDBCollaborationStore()
    const theirs = body().map((n) =>
      n.nodeID === 'r1' ? { ...n, content: 'theirs' } : n
    )
    await store.replaceWithRebased(
      scope,
      {
        bodyVersion: 2,
        bodyEpoch: 2,
        bodySchemaVersion: 1,
        canEdit: true,
        encodedState: stateOf(theirs),
      },
      {
        updateID: 'u1',
        bodyEpoch: 2,
        bodySchemaVersion: 1,
        update: Y.encodeStateAsUpdate(new Y.Doc()),
      },
      [
        {
          nodeID: 'r1',
          reason: 'concurrent-edit',
          local: node('r1', 'p1', 1, 'run', 'mine'),
          canonical: node('r1', 'p1', 1, 'run', 'theirs'),
        },
      ]
    )
    return { scope, store, theirs }
  }

  it('queues the local text as a new pending edit at the current epoch and removes the hold', async () => {
    const { scope, store, theirs } = await seedHeld()
    await acceptHeldEdit({
      scope,
      store,
      nodeID: 'r1',
      fetchBody: async () => canonical(theirs, 2),
    })
    const stored = await store.load(scope)
    expect(stored.heldEdits).toEqual([])
    expect(stored.updates).toHaveLength(2)
    const added = stored.updates.find((u) => u.updateID !== 'u1')!
    expect(added.bodyEpoch).toBe(2)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, stored.snapshot!.encodedState)
    expect(
      projectEncodedState(Y.encodeStateAsUpdate(doc)).find(
        (n) => n.nodeID === 'r1'
      )?.content
    ).toBe('mine')
  })

  it('refuses without current edit access and changes nothing', async () => {
    const { scope, store, theirs } = await seedHeld()
    await expect(
      acceptHeldEdit({
        scope,
        store,
        nodeID: 'r1',
        fetchBody: async () => ({ ...canonical(theirs, 2), canEdit: false }),
      })
    ).rejects.toThrow(/edit access/)
    const stored = await store.load(scope)
    expect(stored.heldEdits).toHaveLength(1)
    expect(stored.updates).toHaveLength(1)
  })

  it('refuses when the document moved to a newer epoch', async () => {
    const { scope, store, theirs } = await seedHeld()
    await expect(
      acceptHeldEdit({
        scope,
        store,
        nodeID: 'r1',
        fetchBody: async () => canonical(theirs, 3),
      })
    ).rejects.toThrow(/changed again/)
    expect((await store.load(scope)).heldEdits).toHaveLength(1)
  })
})
