/** What a user may do in one document. A viewer can only read, a commenter can only suggest. */
export type Access = { canRead: boolean; canEdit: boolean; canSuggest: boolean }

/** The kinds of document that have a room. DBML and Mermaid share their source text (ADR 0033). */
export type DocumentType = 'markdown' | 'architecture' | 'dbdiagram' | 'mermaid'

export const documentTypes: readonly string[] = ['markdown', 'architecture', 'dbdiagram', 'mermaid']

/** A document whose body is one shared source text. */
export const isSourceType = (type: DocumentType) => type === 'dbdiagram' || type === 'mermaid'

/**
 * `documentType` is absent from an API that predates Architecture documents; that means Markdown.
 * `replacementID` is the record the document holds now; a restore replaces it.
 */
export type Authorized = Access & { userID: string; documentType?: string; replacementID?: string }

/** The API refused a store: a restore replaced the record the room was opened on. */
export class ReplacedError extends Error {
  constructor() {
    super('the record was replaced')
  }
}

/** What is kept of a document: the Yjs state and the JSON derived from it. */
export type StoredDocument = {
  workspaceID: string
  documentID: string
  /** The whole Yjs state, as `Y.encodeStateAsUpdate` gives it. */
  state: Uint8Array
  /** The document as JSON: ProseMirror, a canvas, or `{ source }`. */
  content: unknown
  /** The same document as text, for previews, search and exports: Markdown, an Architecture summary, or the source. */
  markdown: string
  /** The user whose edit this store is for, when it is known. */
  updatedBy: string | null
  /** The suggestions the document carries, for the discussion index. */
  suggestions: { id: string; author: string }[]
  /** An architecture room only: the SVG drawn on its document card, empty for an empty canvas. */
  thumbnail?: string
  /** A source room only: the record it was opened on. A store for a replaced record throws ReplacedError. */
  replacementID?: string
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
