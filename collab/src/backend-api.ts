/** What a user may do in one document. A viewer can only read, a commenter can only suggest. */
export type Access = { canRead: boolean; canEdit: boolean; canSuggest: boolean }

export type Authorized = Access & { userID: string }

/** What is kept of a document: the Yjs state and the JSON derived from it. */
export type StoredDocument = {
  workspaceID: string
  documentID: string
  /** The whole Yjs state, as `Y.encodeStateAsUpdate` gives it. */
  state: Uint8Array
  /** The document as ProseMirror JSON. */
  content: unknown
  /** The same document as Markdown, for previews, search and exports. */
  markdown: string
  /** The suggestions the document carries, for the discussion index. */
  suggestions: { id: string; author: string }[]
}

export type LoadedDocument = {
  /** Null for a document made from JSON alone; the service builds the state from `content`. */
  state: Uint8Array | null
  content: unknown | null
}

/** The Go API, seen from the collaboration service. */
export interface BackendApi {
  /** The user behind the token and what they may do here, or null when the token is not valid. */
  authorize(token: string, workspaceID: string, documentID: string): Promise<Authorized | null>
  /** Throws when the document is not in the workspace. */
  loadDocument(workspaceID: string, documentID: string): Promise<LoadedDocument>
  storeState(document: StoredDocument): Promise<void>
}
