/** The documents this tab has open, so sign-out can wait for them and clear what they keep. */
export type OpenDocument = {
  userID: string
  documentID: string
  workspaceID: string
  /** Changes made here that the server has not confirmed. */
  unsyncedChanges: () => number
  /** Resolves true once nothing is waiting for the server, false at the timeout. */
  drained: (timeoutMs: number) => Promise<boolean>
  markdown: () => string
  destroy: () => void
}

const open = new Set<OpenDocument>()

/** Returns the function that takes the document out again. */
export function registerOpenDocument(document: OpenDocument) {
  open.add(document)
  return () => {
    open.delete(document)
  }
}

export function openDocumentsOf(userID: string) {
  return [...open].filter((document) => document.userID === userID)
}
