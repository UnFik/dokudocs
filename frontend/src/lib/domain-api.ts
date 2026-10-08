import { z } from 'zod'
import type {
  DocFilterTab,
  DocType,
  DocumentItem,
  ProjectItem,
  DocumentRevision,
  SortField,
  SortOrder,
  WorkspaceItem,
} from '@/types/dokudocs'
import { apiFetch } from './api-client'

const postgresUUIDSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i)

const workspaceSchema = z.object({
  id: postgresUUIDSchema,
  name: z.string(),
  plan: z.string(),
  logoUrl: z.string().optional().default(''),
  role: z.enum(['owner', 'admin', 'member']),
})

const projectSchema = z.object({
  id: z.string().min(1),
  workspaceId: postgresUUIDSchema,
  name: z.string(),
  description: z.string().optional().default(''),
  logoUrl: z.string().optional().default(''),
  colorBadge: z.string().optional().default(''),
  categories: z
    .array(z.object({ name: z.string(), colorId: z.string() }))
    .optional()
    .default([]),
  isStarred: z.boolean().optional().default(false),
  starredAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const documentSchema = z.object({
  id: z.string().min(1),
  workspaceId: postgresUUIDSchema,
  projectId: z.string().min(1).nullable().optional(),
  projectName: z.string().optional().default(''),
  title: z.string(),
  type: z.enum(['markdown', 'dbdiagram', 'mermaid', 'architecture']),
  content: z.string(),
  contentJSON: z.unknown().optional(),
  replacementId: z.string().uuid().optional(),
  authorId: z.string().min(1),
  author: z.object({
    id: z.string().min(1),
    name: z.string(),
    email: z.string(),
    avatar: z.string().optional().default(''),
  }),
  updatedBy: z
    .object({
      id: z.string().min(1),
      name: z.string(),
      email: z.string(),
      avatar: z.string().optional().default(''),
    })
    .nullable()
    .optional(),
  tags: z.array(z.string()).optional().default([]),
  isDraft: z.boolean(),
  visibility: z.enum(['workspace', 'private', 'public_link', 'inherit']),
  isStarred: z.boolean().optional().default(false),
  starredAt: z.string().nullable().optional(),
  isShared: z.boolean().optional().default(false),
  categories: z.array(z.string()).optional().default([]),
  category: z.string().optional().default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastViewedAt: z.string().nullable().optional(),
  viewCount: z.number().optional().default(0),
  deletedAt: z.string().nullable().optional(),
  thumbnail: z.string().optional().default(''),
  thumbnailDark: z.string().optional().default(''),
  thumbnailPreview: z.string().optional().default(''),
  thumbnailPreviewDark: z.string().optional().default(''),
})

const documentRevisionSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  authorId: z
    .string()
    .regex(/^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/),
  versionNumber: z.number().int().positive(),
  title: z.string().optional().default(''),
  content: z.string(),
  contentJSON: z.unknown().optional(),
  isNamed: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const documentRestoreResultSchema = z.object({
  documentId: z.string().uuid(),
  revisionId: z.string().uuid(),
  sourceRevisionId: z.string().uuid(),
  /** The record the restore made; DBML and Mermaid editors reopen on it. */
  replacementId: z.string().uuid().optional(),
})

const suggestionReplySchema = z.object({
  replyId: z.guid(),
  suggestionId: z.guid(),
  authorId: z.guid(),
  body: z.string(),
  createdAt: z.string(),
})
const documentSuggestionSchema = z.object({
  documentId: z.guid(),
  suggestionId: z.guid(),
  proposerId: z.guid(),
  proposerName: z.string().optional().default(''),
  deciderId: z.guid().nullable().optional(),
  conflictReason: z.string().optional().default(''),
  status: z.enum(['pending', 'accepted', 'rejected', 'conflicted', 'closed']),
  createdAt: z.string(),
  decidedAt: z.string().nullable().optional(),
  resolvedAt: z.string().nullable().optional(),
  resolvedBy: z.guid().nullable().optional(),
  replies: z
    .array(suggestionReplySchema)
    .nullish()
    .transform((v) => v ?? []),
})
// Where a comment sits: the block and two Yjs relative positions, as base64.
const commentAnchorSchema = z.object({
  nodeID: z.string().min(1),
  start: z.string().min(1),
  end: z.string().min(1),
})
// A comment on an Architecture canvas points at an element (a node or a Connection) instead of text,
// and on a node at a point given as a share (0 to 1) of its box. Older threads have no point.
const elementAnchorSchema = z.object({
  kind: z.literal('element'),
  elementId: z.string().min(1),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
})
const commentReplySchema = z.object({
  id: z.guid(),
  threadId: z.guid(),
  authorId: z.guid(),
  authorName: z.string().optional().default(''),
  content: z.string(),
  createdAt: z.string(),
  editedAt: z.string().nullable().optional(),
})
const commentThreadSchema = z
  .object({
    id: z.guid(),
    documentId: z.guid(),
    authorId: z.guid(),
    authorName: z.string().optional().default(''),
    selectedText: z.string().optional().default(''),
    content: z.string(),
    // Threads made before anchors existed have none; a malformed one is none too.
    anchor: z.unknown().optional(),
    createdAt: z.string(),
    editedAt: z.string().nullable().optional(),
    resolvedAt: z.string().nullable().optional(),
    resolvedBy: z.guid().nullable().optional(),
    replies: z
      .array(commentReplySchema)
      .nullish()
      .transform((v) => v ?? []),
  })
  .transform(({ anchor, ...thread }) => {
    const text = commentAnchorSchema.safeParse(anchor)
    const element = elementAnchorSchema.safeParse(anchor)
    return {
      ...thread,
      anchor: text.success ? text.data : null,
      ...(element.success ? { elementAnchor: element.data } : {}),
    }
  })

const shareTokenSchema = z.object({ shareToken: z.string().min(1) })
const ragCitationSchema = z.object({
  chunkId: z.string().uuid().optional(),
  documentId: z.string().uuid(),
  documentTitle: z.string().optional().default(''),
  projectName: z.string().optional().default(''),
  nodeId: z.string().uuid(),
  bodyVersion: z.number().int().positive(),
  sourceFingerprint: z.string().optional(),
  sourceChanged: z.boolean().optional().default(false),
  quotedText: z.string(),
  breadcrumb: z.string(),
  ordinal: z.number().int().nonnegative(),
})
const ragConversationSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  creatorId: z.string().uuid().optional(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
const ragMessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  citations: z.array(ragCitationSchema).optional().default([]),
  coveragePartial: z.boolean().optional().default(false),
  sourcesMayBeIncomplete: z.boolean().optional().default(false),
  createdAt: z.string(),
})
const ragHistorySchema = z.object({
  conversation: ragConversationSchema,
  messages: z.array(ragMessageSchema),
})
const ragAnswerSchema = z.object({
  conversationId: z.string().uuid(),
  text: z.string(),
  citations: z.array(ragCitationSchema),
  coveragePartial: z.boolean(),
  sourcesMayBeIncomplete: z.boolean(),
})

export type DocumentFilters = {
  filterTab?: DocFilterTab
  search?: string
  category?: string
  sortField?: SortField
  sortOrder?: SortOrder
  projectId?: string
}

type CreateDocumentFields = {
  title: string
  visibility?: 'workspace' | 'private' | 'public_link' | 'inherit'
  tags?: string[]
  categories?: string[]
  isDraft?: boolean
  projectId?: string | null
}

export type CreateDocumentInput =
  | (CreateDocumentFields & {
      type: Exclude<DocType, 'markdown' | 'architecture'>
      content?: string
    })
  | (CreateDocumentFields & {
      type: 'architecture'
      /** The canvas; the API starts an empty one when this is left out. */
      contentJSON?: unknown
    })
  | (CreateDocumentFields & {
      type: 'markdown'
      /** The Markdown text, kept for previews and search. */
      content?: string
      /** The document as the editor reads it (ProseMirror JSON). */
      contentJSON?: unknown
    })

export type UpdateDocumentMetadataInput = {
  title?: string
  visibility?: 'workspace' | 'private' | 'public_link' | 'inherit'
  tags?: string[]
  categories?: string[]
  isDraft?: boolean
  projectId?: string | null
}

export type DocumentRestoreResult = z.infer<typeof documentRestoreResultSchema>
export type DocumentSuggestion = z.infer<typeof documentSuggestionSchema>
export type SuggestionReply = z.infer<typeof suggestionReplySchema>
export type CommentAnchor = z.infer<typeof commentAnchorSchema>
export type ElementAnchor = z.infer<typeof elementAnchorSchema>
export type CommentReply = z.infer<typeof commentReplySchema>
export type CommentThread = z.infer<typeof commentThreadSchema>
export type RAGCitation = z.infer<typeof ragCitationSchema>
export type RAGConversation = z.infer<typeof ragConversationSchema>
export type RAGMessage = z.infer<typeof ragMessageSchema>
export type RAGConversationHistory = z.infer<typeof ragHistorySchema>
export type RAGAnswer = z.infer<typeof ragAnswerSchema>
export type CreateWorkspaceInput = {
  name: string
  plan?: string
  logoUrl?: string
}

function toDocument(value: unknown): DocumentItem {
  const doc = documentSchema.parse(value)
  return {
    id: doc.id,
    title: doc.title,
    type: doc.type,
    content: doc.content,
    contentJSON: doc.contentJSON,
    replacementId: doc.replacementId,
    projectId: doc.projectId ?? null,
    projectName: doc.projectName || null,
    category: doc.category || doc.categories[0] || null,
    categories: doc.categories,
    workspaceId: doc.workspaceId,
    orgId: doc.workspaceId,
    author: doc.author,
    updatedBy: doc.updatedBy,
    isStarred: doc.isStarred,
    starredAt: doc.starredAt,
    isShared: doc.isShared,
    isDraft: doc.isDraft,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    lastViewedAt: doc.lastViewedAt,
    viewCount: doc.viewCount,
    deletedAt: doc.deletedAt,
    thumbnail: doc.thumbnail,
    thumbnailDark: doc.thumbnailDark,
    thumbnailPreview: doc.thumbnailPreview,
    thumbnailPreviewDark: doc.thumbnailPreviewDark,
    tags: doc.tags,
  }
}

export function workspaceHeaders(workspaceId: string): HeadersInit {
  return { 'X-Workspace-Id': workspaceId }
}

export async function listWorkspaces(
  signal?: AbortSignal
): Promise<WorkspaceItem[]> {
  const rows = z
    .array(workspaceSchema)
    .parse(await apiFetch<unknown>('/api/v1/workspaces', { signal }))
  return rows.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    plan: workspace.plan,
    avatar: workspace.logoUrl,
    role: workspace.role,
  }))
}

export async function createWorkspace(
  input: CreateWorkspaceInput
): Promise<WorkspaceItem> {
  const workspace = workspaceSchema.parse(
    await apiFetch<unknown>('/api/v1/workspaces', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  )
  return {
    id: workspace.id,
    name: workspace.name,
    plan: workspace.plan,
    avatar: workspace.logoUrl,
    role: workspace.role,
  }
}

export type WorkspacePerson = { id: string; name: string; email: string }

/** The people of a workspace, for naming one in a page. */
export async function listWorkspaceMembers(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkspacePerson[]> {
  const rows = z
    .array(
      z.object({
        userId: z.string().min(1),
        email: z.string(),
        fullName: z.string().optional().default(''),
      })
    )
    .parse(
      await apiFetch<unknown>(`/api/v1/workspaces/${workspaceId}/members`, {
        signal,
      })
    )
  return rows.map((row) => ({
    id: row.userId,
    name: row.fullName || row.email,
    email: row.email,
  }))
}

function toProject(project: z.infer<typeof projectSchema>): ProjectItem {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    logoUrl: project.logoUrl,
    categories: project.categories.map(({ name }) => name),
    categoryColors: Object.fromEntries(
      project.categories.map(({ name, colorId }) => [name, colorId])
    ),
    workspaceId: project.workspaceId,
    orgId: project.workspaceId,
    colorBadge: project.colorBadge,
    isStarred: project.isStarred,
    starredAt: project.starredAt,
    documentIds: [],
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
}

export interface CreateProjectInput {
  name: string
  description?: string
  logoUrl?: string
  categories?: string[]
}

export async function createProject(
  workspaceId: string,
  input: CreateProjectInput
): Promise<ProjectItem> {
  return toProject(
    projectSchema.parse(
      await apiFetch<unknown>('/api/v1/projects', {
        method: 'POST',
        headers: workspaceHeaders(workspaceId),
        body: JSON.stringify(input),
      })
    )
  )
}

export async function toggleProjectStar(
  workspaceId: string,
  projectId: string
): Promise<boolean> {
  const result = z.object({ isStarred: z.boolean() }).parse(
    await apiFetch<unknown>(`/api/v1/projects/${projectId}/star`, {
      method: 'POST',
      headers: workspaceHeaders(workspaceId),
    })
  )
  return result.isStarred
}

export async function listProjects(
  workspaceId: string,
  signal?: AbortSignal
): Promise<ProjectItem[]> {
  const rows = z.array(projectSchema).parse(
    await apiFetch<unknown>('/api/v1/projects', {
      headers: workspaceHeaders(workspaceId),
      signal,
    })
  )
  return rows.map(toProject)
}

export async function listDocuments(
  workspaceId: string,
  filters: DocumentFilters = {},
  signal?: AbortSignal
): Promise<DocumentItem[]> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value)
  }
  const query = params.size ? `?${params}` : ''
  const rows = z.array(documentSchema).parse(
    await apiFetch<unknown>(`/api/v1/documents${query}`, {
      headers: workspaceHeaders(workspaceId),
      signal,
    })
  )
  return rows.map((row) => toDocument(row))
}

export async function getDocument(
  workspaceId: string,
  documentId: string,
  signal?: AbortSignal
): Promise<DocumentItem> {
  return toDocument(
    await apiFetch<unknown>(`/api/v1/documents/${documentId}`, {
      headers: workspaceHeaders(workspaceId),
      signal,
    })
  )
}

export async function getPublicDocument(
  shareToken: string,
  signal?: AbortSignal
): Promise<DocumentItem> {
  return toDocument(
    await apiFetch<unknown>(
      `/api/v1/public/documents/${encodeURIComponent(shareToken)}`,
      { authenticated: false, signal }
    )
  )
}

export async function createDocumentShareToken(
  workspaceId: string,
  documentId: string
): Promise<string> {
  const result = shareTokenSchema.parse(
    await apiFetch<unknown>(`/api/v1/documents/${documentId}/share-token`, {
      method: 'POST',
      headers: workspaceHeaders(workspaceId),
    })
  )
  return result.shareToken
}

export async function listDocumentSuggestions(
  workspaceId: string,
  documentId: string,
  signal?: AbortSignal
): Promise<DocumentSuggestion[]> {
  return z.array(documentSuggestionSchema).parse(
    await apiFetch<unknown>(`/api/v1/documents/${documentId}/suggestions`, {
      headers: workspaceHeaders(workspaceId),
      signal,
    })
  )
}

export const maxSuggestionReplyLength = 2000

export async function replyToDocumentSuggestion(
  workspaceId: string,
  documentId: string,
  suggestionId: string,
  input: { replyID: string; body: string }
): Promise<void> {
  await apiFetch<void>(
    `/api/v1/documents/${documentId}/suggestions/${suggestionId}/replies`,
    {
      method: 'POST',
      headers: workspaceHeaders(workspaceId),
      body: JSON.stringify(input),
    }
  )
}

/** Closes a suggestion's thread, or reopens it. The text is never touched. */
export async function setDocumentSuggestionResolved(
  workspaceId: string,
  documentId: string,
  suggestionId: string,
  resolved: boolean
): Promise<void> {
  await apiFetch<void>(
    `/api/v1/documents/${documentId}/suggestions/${suggestionId}/${resolved ? 'resolve' : 'reopen'}`,
    { method: 'POST', headers: workspaceHeaders(workspaceId) }
  )
}

export const maxCommentLength = 2000
export const maxCommentSelection = 500

export async function listDocumentComments(
  workspaceId: string,
  documentId: string,
  signal?: AbortSignal
): Promise<CommentThread[]> {
  return z.array(commentThreadSchema).parse(
    await apiFetch<unknown>(`/api/v1/documents/${documentId}/comments`, {
      headers: workspaceHeaders(workspaceId),
      signal,
    })
  )
}

/** Starts a thread. The id is the client's, so sending it again changes nothing. */
export async function createDocumentComment(
  workspaceId: string,
  documentId: string,
  input: {
    threadID: string
    selectedText: string
    content: string
    anchor?: CommentAnchor | ElementAnchor
  }
): Promise<void> {
  await apiFetch<void>(`/api/v1/documents/${documentId}/comments`, {
    method: 'POST',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify(input),
  })
}

export async function replyToDocumentComment(
  workspaceId: string,
  documentId: string,
  threadId: string,
  input: { replyID: string; content: string }
): Promise<void> {
  await apiFetch<void>(
    `/api/v1/documents/${documentId}/comments/${threadId}/replies`,
    {
      method: 'POST',
      headers: workspaceHeaders(workspaceId),
      body: JSON.stringify(input),
    }
  )
}

/** Changes the text of a thread's first message. Only its author may. */
export async function editDocumentComment(
  workspaceId: string,
  documentId: string,
  threadId: string,
  content: string
): Promise<void> {
  await apiFetch<void>(`/api/v1/documents/${documentId}/comments/${threadId}`, {
    method: 'PATCH',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify({ content }),
  })
}

/** Removes a thread with its replies. Its author or an editor may. */
export async function deleteDocumentComment(
  workspaceId: string,
  documentId: string,
  threadId: string
): Promise<void> {
  await apiFetch<void>(`/api/v1/documents/${documentId}/comments/${threadId}`, {
    method: 'DELETE',
    headers: workspaceHeaders(workspaceId),
  })
}

export async function editDocumentCommentReply(
  workspaceId: string,
  documentId: string,
  threadId: string,
  replyId: string,
  content: string
): Promise<void> {
  await apiFetch<void>(
    `/api/v1/documents/${documentId}/comments/${threadId}/replies/${replyId}`,
    {
      method: 'PATCH',
      headers: workspaceHeaders(workspaceId),
      body: JSON.stringify({ content }),
    }
  )
}

export async function deleteDocumentCommentReply(
  workspaceId: string,
  documentId: string,
  threadId: string,
  replyId: string
): Promise<void> {
  await apiFetch<void>(
    `/api/v1/documents/${documentId}/comments/${threadId}/replies/${replyId}`,
    { method: 'DELETE', headers: workspaceHeaders(workspaceId) }
  )
}

/** Closes a thread, or reopens it. A reply also reopens it. */
export async function setDocumentCommentResolved(
  workspaceId: string,
  documentId: string,
  threadId: string,
  resolved: boolean
): Promise<void> {
  await apiFetch<void>(
    `/api/v1/documents/${documentId}/comments/${threadId}/${resolved ? 'resolve' : 'reopen'}`,
    { method: 'POST', headers: workspaceHeaders(workspaceId) }
  )
}

export async function listRAGConversations(
  signal?: AbortSignal
): Promise<RAGConversation[]> {
  return z
    .array(ragConversationSchema)
    .parse(await apiFetch<unknown>('/api/v1/rag/conversations', { signal }))
}

export async function getRAGConversation(
  conversationID: string,
  signal?: AbortSignal
): Promise<RAGConversationHistory> {
  return ragHistorySchema.parse(
    await apiFetch<unknown>(`/api/v1/rag/conversations/${conversationID}`, {
      signal,
    })
  )
}

export async function createRAGConversation(
  workspaceId: string
): Promise<RAGConversation> {
  return ragConversationSchema.parse(
    await apiFetch<unknown>('/api/v1/rag/conversations', {
      method: 'POST',
      headers: workspaceHeaders(workspaceId),
      body: JSON.stringify({}),
    })
  )
}

export async function askRAGQuestion(
  workspaceId: string,
  conversationID: string,
  input: {
    question: string
    language: 'id' | 'en'
    publicLinkTokens?: string[]
  }
): Promise<RAGAnswer> {
  return ragAnswerSchema.parse(
    await apiFetch<unknown>(
      `/api/v1/rag/conversations/${conversationID}/messages`,
      {
        method: 'POST',
        headers: workspaceHeaders(workspaceId),
        body: JSON.stringify(input),
      }
    )
  )
}

export async function deleteRAGConversation(
  conversationID: string
): Promise<void> {
  await apiFetch<void>(`/api/v1/rag/conversations/${conversationID}`, {
    method: 'DELETE',
  })
}

export async function listDocumentRevisions(
  workspaceId: string,
  documentId: string,
  signal?: AbortSignal
): Promise<DocumentRevision[]> {
  return z.array(documentRevisionSchema).parse(
    await apiFetch<unknown>(`/api/v1/documents/${documentId}/revisions`, {
      headers: workspaceHeaders(workspaceId),
      signal,
    })
  )
}

export async function createNamedDocumentRevision(
  workspaceId: string,
  documentId: string,
  title: string
): Promise<DocumentRevision> {
  return documentRevisionSchema.parse(
    await apiFetch<unknown>(`/api/v1/documents/${documentId}/revisions`, {
      method: 'POST',
      headers: workspaceHeaders(workspaceId),
      body: JSON.stringify({ title }),
    })
  )
}

export async function restoreDocumentRevision(
  workspaceId: string,
  documentId: string,
  revisionId: string,
  requestID: string
): Promise<DocumentRestoreResult> {
  return documentRestoreResultSchema.parse(
    await apiFetch<unknown>(
      `/api/v1/documents/${documentId}/revisions/${revisionId}/restore`,
      {
        method: 'POST',
        headers: {
          ...workspaceHeaders(workspaceId),
          'Idempotency-Key': requestID,
        },
      }
    )
  )
}

export async function createDocument(
  workspaceId: string,
  input: CreateDocumentInput,
  requestID: string
): Promise<DocumentItem> {
  const payload = {
    ...input,
    visibility: input.visibility ?? 'inherit',
    tags: input.tags ?? [],
    categories: input.categories ?? [],
    isDraft: input.isDraft ?? !input.projectId,
  }
  return toDocument(
    await apiFetch<unknown>('/api/v1/documents', {
      method: 'POST',
      headers: {
        ...workspaceHeaders(workspaceId),
        'Idempotency-Key': requestID,
      },
      body: JSON.stringify(payload),
    })
  )
}

export async function updateDocumentMetadata(
  workspaceId: string,
  documentId: string,
  input: UpdateDocumentMetadataInput
): Promise<DocumentItem> {
  return toDocument(
    await apiFetch<unknown>(`/api/v1/documents/${documentId}`, {
      method: 'PUT',
      headers: workspaceHeaders(workspaceId),
      body: JSON.stringify(input),
    })
  )
}

export async function listDocumentBacklinks(
  workspaceId: string,
  documentId: string
): Promise<{ id: string; title: string }[]> {
  return apiFetch<{ id: string; title: string }[]>(
    `/api/v1/documents/${documentId}/backlinks`,
    { headers: workspaceHeaders(workspaceId) }
  )
}
