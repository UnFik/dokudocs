import { describe, expect, it } from 'vitest'
import { IndexedDBCollaborationStore } from './collaboration-store'

const snapshot = {
  bodyVersion: 1,
  bodyEpoch: 1,
  bodySchemaVersion: 1,
  canEdit: true,
  encodedState: new Uint8Array([1, 2, 3]),
}

describe('IndexedDBCollaborationStore account isolation', () => {
  it('keeps a signed-out user pending edits out of reach of another account on the same device', async () => {
    const store = new IndexedDBCollaborationStore()
    const suffix = crypto.randomUUID()
    const userA = { userID: `user-a-${suffix}`, documentID: 'doc-1' }
    const userB = { userID: `user-b-${suffix}`, documentID: 'doc-1' }
    await store.saveUpdate(userA, snapshot, {
      updateID: 'pending-1',
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      update: new Uint8Array([9]),
    })

    const asB = await store.load(userB)
    expect(asB.snapshot).toBeNull()
    expect(asB.updates).toEqual([])

    const asA = await store.load(userA)
    expect(asA.updates.map((u) => u.updateID)).toEqual(['pending-1'])

    await store.clear(userA)
    expect((await store.load(userA)).updates).toEqual([])
  })

  it('lists the documents with unsynced edits and clears every document of one user only', async () => {
    const store = new IndexedDBCollaborationStore()
    const suffix = crypto.randomUUID()
    const userA = `user-a-${suffix}`
    const userB = `user-b-${suffix}`
    const pending = (updateID: string) => ({
      updateID,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      update: new Uint8Array([9]),
    })
    await store.saveUpdate({ userID: userA, documentID: 'doc-1' }, snapshot, pending('a1'))
    await store.saveUpdate({ userID: userA, documentID: 'doc-1' }, snapshot, pending('a2'))
    await store.saveUpdate({ userID: userA, documentID: 'doc-2' }, snapshot, pending('a3'))
    await store.saveSnapshot({ userID: userA, documentID: 'doc-synced' }, snapshot)
    await store.saveUpdate({ userID: userB, documentID: 'doc-1' }, snapshot, pending('b1'))

    const listed = await store.listPendingDocuments(userA)
    expect(listed.sort((x, y) => x.documentID.localeCompare(y.documentID))).toEqual([
      { documentID: 'doc-1', count: 2 },
      { documentID: 'doc-2', count: 1 },
    ])

    await store.clearUser(userA)
    expect(await store.listPendingDocuments(userA)).toEqual([])
    expect((await store.load({ userID: userA, documentID: 'doc-synced' })).snapshot).toBeNull()
    expect((await store.load({ userID: userB, documentID: 'doc-1' })).updates).toHaveLength(1)
    await store.clearUser(userB)
  })
})
