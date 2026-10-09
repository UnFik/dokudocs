import { afterEach, describe, expect, it } from 'vitest'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import { registerOpenDocument } from './collab-registry'
import {
  discardLocalEdits,
  exportUnsyncedDocuments,
  flushLocalEditsForLogout,
} from './collaboration-logout'

const stops: Array<() => void> = []
afterEach(() => stops.splice(0).forEach((stop) => stop()))

function open(input: {
  userID: string
  documentID: string
  unsynced?: number
  drains?: boolean
}) {
  let destroyed = false
  stops.push(
    registerOpenDocument({
      userID: input.userID,
      documentID: input.documentID,
      workspaceID: 'workspace-1',
      unsyncedChanges: () => input.unsynced ?? 0,
      drained: async () => input.drains ?? (input.unsynced ?? 0) === 0,
      markdown: () => `# ${input.documentID}`,
      destroy: () => {
        destroyed = true
      },
    })
  )
  return { wasDestroyed: () => destroyed }
}

async function localDatabases() {
  return (await indexedDB.databases()).map((database) => database.name)
}

async function createLocalCopy(name: string) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
}

describe('logout and local document data', () => {
  it('clears this device’s copies when everything is synced', async () => {
    const userID = `user-${crypto.randomUUID()}`
    await createLocalCopy('dokudocs:ws.doc-1')
    open({ userID, documentID: 'doc-1' })

    const result = await flushLocalEditsForLogout({ userID })

    expect(result.unsynced).toEqual([])
    expect(await localDatabases()).not.toContain('dokudocs:ws.doc-1')
  })

  it('keeps edits it cannot send and names the documents', async () => {
    const userID = `user-${crypto.randomUUID()}`
    await createLocalCopy('dokudocs:ws.doc-2')
    open({ userID, documentID: 'doc-2', unsynced: 3, drains: false })

    const result = await flushLocalEditsForLogout({ userID, timeoutMs: 20 })

    expect(result.unsynced).toEqual([
      { documentID: 'doc-2', count: 3, workspaceID: 'workspace-1' },
    ])
    expect(await localDatabases()).toContain('dokudocs:ws.doc-2')
  })

  it('does not clear the copy of a closed DBML or Mermaid document it could not send', async () => {
    const userID = `user-${crypto.randomUUID()}`
    // Copies the other tests leave are empty databases, not documents.
    await discardLocalEdits(userID)
    // Named after its record; no server answers here, so nothing reaches it.
    const doc = new Y.Doc()
    const copy = new IndexeddbPersistence('dokudocs:ws.doc-9.record-1', doc)
    await copy.whenSynced
    doc.getText('source').insert(0, 'Table unsent {}')
    await copy.destroy()

    const result = await flushLocalEditsForLogout({
      userID,
      token: () => 'token',
      timeoutMs: 50,
    })

    expect(result.unsynced.map((item) => item.documentID)).toContain('doc-9')
    expect(await localDatabases()).toContain('dokudocs:ws.doc-9.record-1')
    await discardLocalEdits(userID)
  })

  it('discards local copies and stops open editors on request', async () => {
    const userID = `user-${crypto.randomUUID()}`
    await createLocalCopy('dokudocs:ws.doc-3')
    const doc = open({
      userID,
      documentID: 'doc-3',
      unsynced: 1,
      drains: false,
    })

    await discardLocalEdits(userID)

    expect(doc.wasDestroyed()).toBe(true)
    expect(await localDatabases()).not.toContain('dokudocs:ws.doc-3')
  })

  it('exports an unsynced document as Markdown', async () => {
    const userID = `user-${crypto.randomUUID()}`
    open({ userID, documentID: 'doc-4', unsynced: 2, drains: false })

    const exported = await exportUnsyncedDocuments(userID, [
      { documentID: 'doc-4', count: 2, workspaceID: 'workspace-1' },
    ])

    expect(exported).toBe(1)
  })
})
