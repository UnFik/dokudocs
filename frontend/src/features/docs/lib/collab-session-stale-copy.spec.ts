import { afterEach, beforeEach, expect, it } from 'vitest'
import { dropStaleLocalCopy, hasLocalCopy } from './collab-session'

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const documentID = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'
const database = `dokudocs:${workspaceID}.${documentID}`

function createLocalCopy() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(database, 1)
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
}

function removeLocalCopy() {
  return new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(database)
    request.onsuccess = request.onerror = request.onblocked = () => resolve()
  })
}

beforeEach(async () => {
  window.localStorage.clear()
  await removeLocalCopy()
})

afterEach(async () => {
  window.localStorage.clear()
  await removeLocalCopy()
})

it('keeps the copy of a record this device already opened', async () => {
  await dropStaleLocalCopy(workspaceID, documentID, first)
  await createLocalCopy()

  expect(await dropStaleLocalCopy(workspaceID, documentID, first)).toBe(false)
  expect(await hasLocalCopy(workspaceID, documentID)).toBe(true)
})

it('drops the copy when a restore replaced the record while the device was away', async () => {
  await dropStaleLocalCopy(workspaceID, documentID, first)
  await createLocalCopy()

  expect(await dropStaleLocalCopy(workspaceID, documentID, second)).toBe(true)
  expect(await hasLocalCopy(workspaceID, documentID)).toBe(false)
  // The new record is remembered, so the next open keeps what it syncs.
  await createLocalCopy()
  expect(await dropStaleLocalCopy(workspaceID, documentID, second)).toBe(false)
  expect(await hasLocalCopy(workspaceID, documentID)).toBe(true)
})

it('drops a copy made before the device remembered any record', async () => {
  await createLocalCopy()

  expect(await dropStaleLocalCopy(workspaceID, documentID, first)).toBe(true)
  expect(await hasLocalCopy(workspaceID, documentID)).toBe(false)
})

it('has nothing to drop on a first visit, and leaves a document with no record alone', async () => {
  expect(await dropStaleLocalCopy(workspaceID, documentID, first)).toBe(false)

  await createLocalCopy()
  expect(await dropStaleLocalCopy(workspaceID, documentID, undefined)).toBe(
    false
  )
  expect(await hasLocalCopy(workspaceID, documentID)).toBe(true)
})
