/** What a user may do in one document. A viewer can only read, a commenter can only suggest. */
export type Access = { canRead: boolean; canEdit: boolean; canSuggest: boolean }

/** The kinds of document that have a room. DBML and Mermaid documents stay plain text (ADR 0001). */
export type DocumentType = 'markdown' | 'architecture'

/** `documentType` is absent from an API that predates Architecture documents; that means Markdown. */
export type Authorized = Access & { userID: string; documentType?: string }

/** What is kept of a document: the Yjs state and the JSON derived from it. */
export type StoredDocument = {
  workspaceID: string
  documentID: string
  /** The whole Yjs state, as `Y.encodeStateAsUpdate` gives it. */
  state: Uint8Array
  /** The document as ProseMirror JSON. */
  content: unknown
  /** The same document as text, for previews, search and exports: Markdown, or an Architecture summary. */
  markdown: string
  /** The user whose edit this store is for, when it is known. */
  updatedBy: string | null
  /** The suggestions the document carries, for the discussion index. */
  suggestions: { id: string; author: string }[]
  /** An architecture room only: the SVG drawn on its document card, empty for an empty canvas. */
  thumbnail?: string
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
