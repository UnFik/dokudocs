import * as Y from 'yjs'
import { getMarkdownBody } from '@/lib/domain-api'
import {
  CollaborativeDocumentProvider,
  activeProviderFor,
} from './collaboration-provider'
import { recoverPendingMarkdown } from './collaboration-recovery'
import { IndexedDBCollaborationStore } from './collaboration-store'

export type UnsyncedDocument = {
  documentID: string
  count: number
  workspaceID: string | undefined
}

type FlushOptions = {
  userID: string
  token: () => string
  workspaceOf: (documentID: string) => string | undefined
  timeoutMs?: number
}

const defaultFlushTimeoutMs = 15_000

/**
 * ADR 0007: before logout, send pending edits to the server, then clear the
 * account's local document data. Edits that cannot be sent are left in place
 * and returned so the caller can ask the user what to do with them.
 */
export async function flushLocalEditsForLogout(options: FlushOptions) {
  const store = new IndexedDBCollaborationStore()
  const pending = await store.listPendingDocuments(options.userID)
  const timeoutMs = options.timeoutMs ?? defaultFlushTimeoutMs
  const outcomes = await Promise.all(
    pending.map(async ({ documentID, count }) => ({
      documentID,
      count,
      workspaceID: options.workspaceOf(documentID),
      flushed: await flushDocument(options, store, documentID, timeoutMs),
    }))
  )
  const unsynced = outcomes
    .filter((outcome) => !outcome.flushed)
    .map(({ documentID, count, workspaceID }) => ({
      documentID,
      count,
      workspaceID,
    }))
  if (unsynced.length === 0) await clearLocalData(options.userID, store)
  return { unsynced }
}

export async function discardLocalEdits(userID: string) {
  await clearLocalData(userID, new IndexedDBCollaborationStore())
}

async function clearLocalData(
  userID: string,
  store: IndexedDBCollaborationStore
) {
  // Open editors would write their snapshot again after the clear.
  const open = (await store.listAllDocuments(userID)).flatMap((documentID) => {
    const provider = activeProviderFor({ userID, documentID })
    return provider ? [provider] : []
  })
  for (const provider of open) provider.stop()
  await Promise.all(open.map((provider) => provider.settled()))
  await store.clearUser(userID)
}

async function flushDocument(
  options: FlushOptions,
  store: IndexedDBCollaborationStore,
  documentID: string,
  timeoutMs: number
) {
  const scope = { userID: options.userID, documentID }
  const open = activeProviderFor(scope)
  if (open) return open.whenDrained(timeoutMs)
  const workspaceID = options.workspaceOf(documentID)
  if (!workspaceID || (typeof navigator !== 'undefined' && !navigator.onLine))
    return false
  const { snapshot } = await store.load(scope)
  if (!snapshot) return false
  const document = new Y.Doc()
  const provider = new CollaborativeDocumentProvider({
    documentID,
    workspaceID,
    userID: options.userID,
    token: options.token,
    document,
    bodyVersion: snapshot.bodyVersion,
    bodyEpoch: snapshot.bodyEpoch,
    bodySchemaVersion: snapshot.bodySchemaVersion,
    canEdit: snapshot.canEdit,
    store,
  })
  try {
    await provider.start()
    return await provider.whenDrained(timeoutMs)
  } finally {
    provider.stop()
    await provider.settled()
    document.destroy()
  }
}

/** Downloads each unsynced document as Markdown after confirming read access. */
export async function exportUnsyncedDocuments(
  userID: string,
  documents: UnsyncedDocument[]
) {
  let exported = 0
  for (const { documentID, workspaceID } of documents) {
    if (!workspaceID) continue
    await getMarkdownBody(workspaceID, documentID)
    const markdown = await recoverPendingMarkdown({ userID, documentID })
    if (markdown === null) continue
    const url = URL.createObjectURL(
      new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
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
