import { describe, expect, it } from 'vitest'
import {
  discardLocalEdits,
  flushLocalEditsForLogout,
} from './collaboration-logout'
import { IndexedDBCollaborationStore } from './collaboration-store'

const snapshot = {
  bodyVersion: 1,
  bodyEpoch: 1,
  bodySchemaVersion: 1,
  canEdit: true,
  encodedState: new Uint8Array([1]),
}
const pendingUpdate = {
  updateID: 'pending-1',
  bodyEpoch: 1,
  bodySchemaVersion: 1,
  update: new Uint8Array([9]),
}

describe('logout and local collaboration data', () => {
  it('clears cached bodies with nothing pending and reports nothing unsynced', async () => {
    const store = new IndexedDBCollaborationStore()
    const userID = `user-${crypto.randomUUID()}`
    await store.saveSnapshot({ userID, documentID: 'doc-1' }, snapshot)

    const result = await flushLocalEditsForLogout({
      userID,
      token: () => 'jwt',
      workspaceOf: () => 'workspace-1',
    })

    expect(result.unsynced).toEqual([])
    expect(
      (await store.load({ userID, documentID: 'doc-1' })).snapshot
    ).toBeNull()
  })

  it('keeps edits it cannot send and names the documents', async () => {
    const store = new IndexedDBCollaborationStore()
    const userID = `user-${crypto.randomUUID()}`
    await store.saveUpdate(
      { userID, documentID: 'doc-1' },
      snapshot,
      pendingUpdate
    )

    const result = await flushLocalEditsForLogout({
      userID,
      token: () => 'jwt',
      workspaceOf: () => undefined,
    })

    expect(result.unsynced).toEqual([
      { documentID: 'doc-1', count: 1, workspaceID: undefined },
    ])
    expect(
      (await store.load({ userID, documentID: 'doc-1' })).updates
    ).toHaveLength(1)
    await store.clearUser(userID)
  })

  it('discards everything the user holds only when asked to', async () => {
    const store = new IndexedDBCollaborationStore()
    const userID = `user-${crypto.randomUUID()}`
    await store.saveUpdate(
      { userID, documentID: 'doc-1' },
      snapshot,
      pendingUpdate
    )

    await discardLocalEdits(userID)

    expect(await store.listPendingDocuments(userID)).toEqual([])
  })
})
