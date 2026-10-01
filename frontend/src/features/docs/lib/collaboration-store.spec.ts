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
})
