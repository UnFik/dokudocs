import { openDocumentsOf } from './collab-registry'

export type UnsyncedDocument = {
  documentID: string
  count: number
  workspaceID: string | undefined
}

type FlushOptions = {
  userID: string
  timeoutMs?: number
}

const defaultFlushTimeoutMs = 15_000
const localCopyPrefix = 'dokudocs:'

/**
 * ADR 0007: before logout, wait for the open documents to reach the server,
 * then clear this device's copies. A document that does not get there is left
 * in place and returned so the caller can ask the user what to do with it.
 */
export async function flushLocalEditsForLogout(options: FlushOptions) {
  const timeoutMs = options.timeoutMs ?? defaultFlushTimeoutMs
  const open = openDocumentsOf(options.userID)
  const outcomes = await Promise.all(
    open.map(async (document) => ({
      document,
      drained: await document.drained(timeoutMs),
    }))
  )
  const unsynced: UnsyncedDocument[] = outcomes
    .filter((outcome) => !outcome.drained)
    .map(({ document }) => ({
      documentID: document.documentID,
      count: document.unsyncedChanges(),
      workspaceID: document.workspaceID,
    }))
  if (unsynced.length === 0) await clearLocalCopies()
  return { unsynced }
}

export async function discardLocalEdits(userID: string) {
  // Open editors would write their copy again after the clear.
  for (const document of openDocumentsOf(userID)) document.destroy()
  await clearLocalCopies()
}

async function clearLocalCopies() {
  const databases = await indexedDB.databases()
  await Promise.all(
    databases
      .map((database) => database.name)
      .filter((name): name is string => !!name?.startsWith(localCopyPrefix))
      .map(
        (name) =>
          new Promise<void>((resolve) => {
            const request = indexedDB.deleteDatabase(name)
            request.onsuccess =
              request.onerror =
              request.onblocked =
                () => resolve()
          })
      )
  )
  try {
    for (const key of Object.keys(window.localStorage))
      if (key.startsWith(localCopyPrefix)) window.localStorage.removeItem(key)
  } catch {
    // The access cache is only a convenience.
  }
}

/** Downloads each unsynced document, still open in this tab, as Markdown. */
export async function exportUnsyncedDocuments(
  userID: string,
  documents: UnsyncedDocument[]
) {
  const open = openDocumentsOf(userID)
  let exported = 0
  for (const { documentID } of documents) {
    const document = open.find((item) => item.documentID === documentID)
    if (!document) continue
    const url = URL.createObjectURL(
      new Blob([document.markdown()], { type: 'text/markdown;charset=utf-8' })
    )
    const link = window.document.createElement('a')
    link.href = url
    link.download = `${documentID}-offline-recovery.md`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    exported++
  }
  return exported
}
