/** What a user may do in one document. A viewer can only read, a commenter can only suggest. */
export type Access = { canRead: boolean; canEdit: boolean; canSuggest: boolean }

export type Authorized = Access & { userID: string }

export type StoredDocument = {
  workspaceID: string
  documentID: string
  /** The whole Yjs state, as `Y.encodeStateAsUpdate` gives it. */
  state: Uint8Array
}

/** The Go API, seen from the collaboration service. */
export interface BackendApi {
  /** The user behind the token and what they may do here, or null when the token is not valid. */
  authorize(token: string, workspaceID: string, documentID: string): Promise<Authorized | null>
  /** The stored state, or null for a document that has none yet. */
  loadState(workspaceID: string, documentID: string): Promise<Uint8Array | null>
  storeState(document: StoredDocument): Promise<void>
}
