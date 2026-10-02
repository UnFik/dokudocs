import { describe, expect, it } from 'vitest'
import { prosemirrorToYXmlFragment } from 'y-prosemirror'
import * as Y from 'yjs'
import {
  loadOfflineMarkdownBody,
  recoverPendingMarkdown,
} from './collaboration-recovery'
import { IndexedDBCollaborationStore } from './collaboration-store'
import type { DocumentBodyNode } from './documentBody'
import { documentBodyToProseMirror } from './prosemirror/documentBody'

const nodes: DocumentBodyNode[] = [
  {
    nodeID: 'root',
    parentID: null,
    siblingOrder: 1,
    type: 'document',
    content: '',
    attributes: {},
  },
  {
    nodeID: 'p1',
    parentID: 'root',
    siblingOrder: 1,
    type: 'paragraph',
    content: '',
    attributes: {},
  },
  {
    nodeID: 'r1',
    parentID: 'p1',
    siblingOrder: 1,
    type: 'run',
    content: 'hello',
    attributes: {},
  },
]

function state() {
  const doc = new Y.Doc()
  prosemirrorToYXmlFragment(
    documentBodyToProseMirror(nodes),
    doc.getXmlFragment('body')
  )
  return Y.encodeStateAsUpdate(doc)
}

const snapshot = () => ({
  bodyVersion: 1,
  bodyEpoch: 1,
  bodySchemaVersion: 1,
  canEdit: true,
  encodedState: state(),
})

describe('offline durability of the device store (#17)', () => {
  it('a new store instance (browser restart) still sees the snapshot and a pending delete', async () => {
    const scope = {
      userID: crypto.randomUUID(),
      documentID: crypto.randomUUID(),
    }
    await new IndexedDBCollaborationStore().saveDeleteCommand(
      scope,
      snapshot(),
      {
        commandID: 'c1',
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        nodeIDs: ['p1'],
      }
    )
    const reopened = await new IndexedDBCollaborationStore().load(scope)
    expect(reopened.snapshot?.bodyEpoch).toBe(1)
    expect(reopened.deleteCommands.map((c) => c.commandID)).toEqual(['c1'])
    expect(await loadOfflineMarkdownBody(scope)).not.toBeNull()
  })

  it('after storage eviction nothing is offered offline and recovery reports nothing instead of throwing', async () => {
    const scope = {
      userID: crypto.randomUUID(),
      documentID: crypto.randomUUID(),
    }
    const store = new IndexedDBCollaborationStore()
    await store.saveSnapshot(scope, snapshot())
    expect(await loadOfflineMarkdownBody(scope)).not.toBeNull()

    await store.clear(scope)

    expect(await loadOfflineMarkdownBody(scope)).toBeNull()
    expect(await recoverPendingMarkdown(scope)).toBeNull()
    expect(
      (await new IndexedDBCollaborationStore().load(scope)).heldEdits
    ).toEqual([])
  })

  it("does not leak one account's pending state to another on the same document", async () => {
    const documentID = crypto.randomUUID()
    const first = { userID: crypto.randomUUID(), documentID }
    const second = { userID: crypto.randomUUID(), documentID }
    await new IndexedDBCollaborationStore().saveSnapshot(first, snapshot())
    expect(
      (await new IndexedDBCollaborationStore().load(second)).snapshot
    ).toBeNull()
  })
})
