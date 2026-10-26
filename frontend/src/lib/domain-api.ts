import { z } from 'zod'
import type {
  DocFilterTab,
  DocType,
  DocumentItem,
  ProjectItem,
  DocumentRevision,
  SortField,
  ProjectMemberItem,
  ProjectMemberRole,
  SortOrder,
  TrashItem,
  WorkspaceItem,
} from '@/types/dokudocs'
import { apiFetch } from './api-client'
import { documentTypeSchema } from './document-types'

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
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string(),
        colorId: z.string(),
      })
    )
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
  type: documentTypeSchema,
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
  aiAssisted: z.boolean().optional(),
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
// A comment on a DBML or Mermaid source points at the words, by two Yjs relative positions.
const sourceAnchorSchema = z.object({
  kind: z.literal('source'),
  start: z.string().min(1),
  end: z.string().min(1),
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
    const source = sourceAnchorSchema.safeParse(anchor)
    return {
      ...thread,
      anchor: text.success ? text.data : null,
      ...(element.success ? { elementAnchor: element.data } : {}),
      ...(source.success ? { sourceAnchor: source.data } : {}),
    }
  })

const shareTokenSchema = z.object({ shareToken: z.string().min(1) })
const ragCitationSchema = z.object({
  chunkId: z.string().uuid().optional(),
  documentId: z.string().uuid(),
  documentTitle: z.string().optional().default(''),
  projectName: z.string().optional().default(''),
  nodeId: z.string().uuid(),
  // 0 on a source the reader can no longer open.
  bodyVersion: z.number().int().nonnegative(),
  sourceFingerprint: z.string().optional(),
  sourceChanged: z.boolean().optional().default(false),
  quotedText: z.string(),
  breadcrumb: z.string(),
  ordinal: z.number().int().nonnegative(),
  /** The reader lost access to the document: the server withholds its title and quote. */
  unavailable: z.boolean().optional().default(false),
})
const ragConversationSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  creatorId: z.guid().optional(),
  documentId: z.string().uuid().optional(),
  documentTitle: z.string().optional(),
  title: z.string(),
  pinnedAt: z.string().optional(),
  archivedAt: z.string().optional(),
  unread: z.boolean().optional().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
})
const ragCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  projectName: z.string(),
})
const ragUsageSchema = z.object({
  used: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  resetsAt: z.string(),
})
const ragMessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  citations: z.array(ragCitationSchema).optional().default([]),
  coveragePartial: z.boolean().optional().default(false),
  sourcesMayBeIncomplete: z.boolean().optional().default(false),
  meta: z
    .object({
      agent: z.boolean().optional(),
      tools: z.array(z.string()).optional(),
      /** Each tool call, with the document it worked on when it named one. */
      calls: z
        .array(
          z.object({
            name: z.string(),
            documentId: z.string().uuid().optional(),
          })
        )
        .optional(),
      actions: z.array(z.string()).optional(),
      skill: z.string().optional(),
    })
    .optional(),
  /** The documents a question names; available is false once the User cannot read one. */
  mentions: z
    .array(
      z.object({
        documentId: z.string().uuid(),
        title: z.string(),
        available: z.boolean(),
      })
    )
    .optional(),
  createdAt: z.string(),
})
const agentActionSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  tool: z.string(),
  summary: z.string(),
  status: z.enum(['pending', 'approved', 'declined', 'failed']),
  result: z.string().optional().default(''),
})
const ragHistorySchema = z.object({
  conversation: ragConversationSchema,
  messages: z.array(ragMessageSchema),
  actions: z.array(agentActionSchema).optional(),
  /** Pass as `before` to read the page of older messages; absent at the first message. */
  nextCursor: z.string().nullish(),
})
const skillSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  instructions: z.string().optional().default(''),
  updatedAt: z.string().optional(),
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
      type: Exclude<DocType, 'markdown' | 'architecture' | 'html'>
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
export type SourceCommentAnchor = z.infer<typeof sourceAnchorSchema>
export type CommentReply = z.infer<typeof commentReplySchema>
export type CommentThread = z.infer<typeof commentThreadSchema>
export type RAGCitation = z.infer<typeof ragCitationSchema>
export type RAGConversation = z.infer<typeof ragConversationSchema>
export type RAGUsage = z.infer<typeof ragUsageSchema>
export type RAGCategory = z.infer<typeof ragCategorySchema>
export type RAGMessage = z.infer<typeof ragMessageSchema>
export type RAGConversationHistory = z.infer<typeof ragHistorySchema>
export type AgentAction = z.infer<typeof agentActionSchema>
export type Skill = z.infer<typeof skillSchema>
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

const documentPreviewSchema = z.object({
  title: z.string(),
  type: z.string(),
  excerpt: z.string().optional(),
  thumbnail: z.string().optional(),
  thumbnailDark: z.string().optional(),
  author: z.object({ name: z.string().optional() }).optional(),
  updatedAt: z.string().optional(),
})

export type DocumentHoverPreview = {
  kind: 'document'
  title: string
  type: string
  excerpt?: string
  thumbnail?: string
  thumbnailDark?: string
  authorName?: string
  updatedAt?: string
}

export type PersonHoverPreview = {
  kind: 'person'
  name: string
  email: string
  role: string
  bio?: string
  avatarUrl?: string
}

/** What a hover card shows of a page; fetched only when it is hovered. */
export async function getDocumentHoverPreview(
  workspaceId: string,
  documentId: string,
  signal?: AbortSignal
): Promise<DocumentHoverPreview> {
  const row = documentPreviewSchema.parse(
    await apiFetch<unknown>(`/api/v1/documents/${documentId}/preview`, {
      headers: workspaceHeaders(workspaceId),
      signal,
    })
  )
  return {
    kind: 'document',
    title: row.title,
    type: row.type,
    excerpt: row.excerpt,
    thumbnail: row.thumbnail,
    thumbnailDark: row.thumbnailDark,
    authorName: row.author?.name,
    updatedAt: row.updatedAt,
  }
}

const memberProfileSchema = z.object({
  email: z.string(),
  fullName: z.string().optional().default(''),
  avatarUrl: z.string().optional().default(''),
  bio: z.string().optional().default(''),
  role: z.string(),
})

/** What a hover card shows of a person in the workspace; fetched only when hovered. */
export async function getMemberHoverPreview(
  workspaceId: string,
  userId: string,
  signal?: AbortSignal
): Promise<PersonHoverPreview> {
  const row = memberProfileSchema.parse(
    await apiFetch<unknown>(
      `/api/v1/workspaces/${workspaceId}/members/${userId}/profile`,
      { signal }
    )
  )
  return {
    kind: 'person',
    name: row.fullName || row.email,
    email: row.email,
    role: row.role,
    bio: row.bio || undefined,
    avatarUrl: row.avatarUrl || undefined,
  }
}

const rosterSchema = z.array(
  z.object({
    userId: z.string().min(1),
    email: z.string(),
    fullName: z.string().optional().default(''),
    avatarUrl: z.string().optional().default(''),
    role: z.string(),
    joinedAt: z.string(),
  })
)

export type WorkspaceMemberRow = z.infer<typeof rosterSchema>[number]

/** Everyone in a workspace, with the role each one holds. */
export async function listWorkspaceRoster(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkspaceMemberRow[]> {
  return rosterSchema.parse(
    await apiFetch<unknown>(`/api/v1/workspaces/${workspaceId}/members`, {
      signal,
    })
  )
}

export async function removeWorkspaceMember(
  workspaceId: string,
  userId: string
): Promise<void> {
  await apiFetch(`/api/v1/workspaces/${workspaceId}/members/${userId}`, {
    method: 'DELETE',
  })
}

const inviteSchema = z.object({
  id: z.string().min(1),
  email: z.string(),
  role: z.string(),
  expiresAt: z.string(),
  lastSentAt: z.string(),
})

export type WorkspaceInviteRow = z.infer<typeof inviteSchema>

export type InviteRole = 'member' | 'admin'

export async function inviteWorkspaceMember(
  workspaceId: string,
  input: { email: string; role: InviteRole }
): Promise<WorkspaceInviteRow> {
  return inviteSchema.parse(
    await apiFetch<unknown>(`/api/v1/workspaces/${workspaceId}/invites`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  )
}

/** Invitations nobody has used yet. Only an owner or admin may ask. */
export async function listWorkspaceInvites(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkspaceInviteRow[]> {
  const rows = await apiFetch<unknown>(
    `/api/v1/workspaces/${workspaceId}/invites`,
    { signal }
  )
  return z.array(inviteSchema).parse(rows ?? [])
}

export async function resendWorkspaceInvite(
  workspaceId: string,
  inviteId: string
): Promise<void> {
  await apiFetch(
    `/api/v1/workspaces/${workspaceId}/invites/${inviteId}/resend`,
    { method: 'POST' }
  )
}

export async function revokeWorkspaceInvite(
  workspaceId: string,
  inviteId: string
): Promise<void> {
  await apiFetch(`/api/v1/workspaces/${workspaceId}/invites/${inviteId}`, {
    method: 'DELETE',
  })
}

const invitePreviewSchema = z.object({
  workspaceName: z.string(),
  inviterName: z.string(),
  role: z.string(),
  email: z.string(),
})

export type InvitePreview = z.infer<typeof invitePreviewSchema>

/** What an invitation link offers. Needs no sign-in. */
export async function previewInvite(
  token: string,
  signal?: AbortSignal
): Promise<InvitePreview> {
  return invitePreviewSchema.parse(
    await apiFetch<unknown>('/api/v1/invites/preview', {
      method: 'POST',
      authenticated: false,
      body: JSON.stringify({ token }),
      signal,
    })
  )
}

/** Joins the workspace as the signed-in User; resolves to the workspace id. */
export async function acceptInvite(token: string): Promise<string> {
  const { workspaceId } = z.object({ workspaceId: postgresUUIDSchema }).parse(
    await apiFetch<unknown>('/api/v1/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
  )
  return workspaceId
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
    categoryIds: Object.fromEntries(
      project.categories.flatMap(({ id, name }) => (id ? [[name, id]] : []))
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

export async function toggleDocumentStar(
  workspaceId: string,
  documentId: string
): Promise<boolean> {
  const result = z.object({ isStarred: z.boolean() }).parse(
    await apiFetch<unknown>(`/api/v1/documents/${documentId}/star`, {
      method: 'POST',
      headers: workspaceHeaders(workspaceId),
    })
  )
  return result.isStarred
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

export async function deleteProject(
  workspaceId: string,
  projectId: string
): Promise<void> {
  await apiFetch<unknown>(`/api/v1/projects/${projectId}`, {
    method: 'DELETE',
    headers: workspaceHeaders(workspaceId),
  })
}

// The trash list does not load visibility, and sends tags and categories as
// null when there are none.
const trashDocumentSchema = documentSchema.extend({
  visibility: documentSchema.shape.visibility.catch('inherit'),
  tags: z
    .array(z.string())
    .nullish()
    .transform((tags) => tags ?? []),
  categories: z
    .array(z.string())
    .nullish()
    .transform((categories) => categories ?? []),
})

const trashItemSchema = z.object({
  id: z.string().min(1),
  docId: z.string().min(1),
  document: trashDocumentSchema,
  deletedAt: z.string(),
  deletedBy: z.object({
    id: z.string().min(1),
    name: z.string(),
    email: z.string(),
    avatar: z.string().optional().default(''),
  }),
  daysRemaining: z.number(),
})

export async function listTrash(
  workspaceId: string,
  signal?: AbortSignal
): Promise<TrashItem[]> {
  const rows = z.array(trashItemSchema).parse(
    await apiFetch<unknown>('/api/v1/trash', {
      headers: workspaceHeaders(workspaceId),
      signal,
    })
  )
  return rows.map((row) => ({ ...row, document: toDocument(row.document) }))
}

export async function moveDocumentToTrash(
  workspaceId: string,
  documentId: string
): Promise<void> {
  await apiFetch<unknown>(`/api/v1/documents/${documentId}`, {
    method: 'DELETE',
    headers: workspaceHeaders(workspaceId),
  })
}

export async function restoreDocument(
  workspaceId: string,
  documentId: string
): Promise<void> {
  await apiFetch<unknown>(`/api/v1/documents/${documentId}/restore`, {
    method: 'POST',
    headers: workspaceHeaders(workspaceId),
  })
}

export async function permanentlyDeleteDocument(
  workspaceId: string,
  documentId: string
): Promise<void> {
  await apiFetch<unknown>(`/api/v1/documents/${documentId}/permanent`, {
    method: 'DELETE',
    headers: workspaceHeaders(workspaceId),
  })
}

export async function emptyTrash(workspaceId: string): Promise<void> {
  await apiFetch<unknown>('/api/v1/trash', {
    method: 'DELETE',
    headers: workspaceHeaders(workspaceId),
  })
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

const documentSearchHitSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  type: documentTypeSchema,
  projectId: z.string().nullable().optional(),
  projectName: z.string().optional().default(''),
  isDraft: z.boolean(),
  updatedAt: z.string(),
  matchedOn: z.enum(['title', 'body']).optional(),
  snippet: z.string().optional().default(''),
})

export type DocumentSearchHit = z.infer<typeof documentSearchHitSchema>

/** Documents the user can read that match `query`; an empty query lists recent ones. */
export async function searchDocuments(
  workspaceId: string,
  query: string,
  signal?: AbortSignal
): Promise<DocumentSearchHit[]> {
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  const suffix = params.size ? `?${params}` : ''
  return z.array(documentSearchHitSchema).parse(
    await apiFetch<unknown>(`/api/v1/documents/search${suffix}`, {
      headers: workspaceHeaders(workspaceId),
      signal,
    })
  )
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

export type MentionCandidate = {
  userId: string
  name: string
  email: string
  canRead: boolean
}

/** Whom a comment on the document may name, and whether they can read it. */
export async function listMentionable(
  workspaceId: string,
  documentId: string,
  signal?: AbortSignal
): Promise<MentionCandidate[]> {
  return z
    .array(
      z.object({
        userId: z.guid(),
        name: z.string(),
        email: z.string(),
        canRead: z.boolean(),
      })
    )
    .parse(
      await apiFetch<unknown>(`/api/v1/documents/${documentId}/mentionable`, {
        headers: workspaceHeaders(workspaceId),
        signal,
      })
    )
}

const pageTicketSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
  capabilities: z.array(z.string()),
  canEdit: z.boolean(),
  canComment: z.boolean(),
})

export type PageTicket = z.infer<typeof pageTicketSchema>

/** Asks for the address of the sandboxed frame that shows an HTML document. */
export async function getHtmlPageTicket(
  workspaceId: string,
  documentId: string,
  signal?: AbortSignal
): Promise<PageTicket> {
  return pageTicketSchema.parse(
    await apiFetch<unknown>(`/api/v1/documents/${documentId}/page`, {
      method: 'POST',
      headers: workspaceHeaders(workspaceId),
      signal,
    })
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
    anchor?: CommentAnchor | ElementAnchor | SourceCommentAnchor
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

/** One page of a conversation: the newest messages, or the ones before `before`. */
export async function getRAGConversation(
  conversationID: string,
  signal?: AbortSignal,
  before?: string
): Promise<RAGConversationHistory> {
  const query = before ? `?before=${encodeURIComponent(before)}` : ''
  return ragHistorySchema.parse(
    await apiFetch<unknown>(
      `/api/v1/rag/conversations/${conversationID}${query}`,
      { signal }
    )
  )
}

export type ChatDocumentHit = {
  id: string
  title: string
  type: string
  projectName: string
  /** In the project's order. */
  categories: string[]
}

/** Documents the User can read in the workspace whose title contains the text, for the @ picker. */
export async function searchChatDocuments(
  workspaceId: string,
  text: string,
  signal?: AbortSignal
): Promise<ChatDocumentHit[]> {
  const query = text ? `?search=${encodeURIComponent(text)}` : ''
  return z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string(),
        type: z.string(),
        projectName: z.string().optional().default(''),
        categories: z.array(z.string()).optional().default([]),
      })
    )
    .parse(
      await apiFetch<unknown>(`/api/v1/rag/document-search${query}`, {
        headers: workspaceHeaders(workspaceId),
        signal,
      })
    )
}

/** Names the documents an answer refers to; those the User cannot read now are left out. */
export async function lookupChatDocuments(
  workspaceId: string,
  ids: string[],
  signal?: AbortSignal
): Promise<ChatDocumentHit[]> {
  if (ids.length === 0) return []
  return z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string(),
        type: z.string(),
        projectName: z.string().optional().default(''),
        categories: z.array(z.string()).optional().default([]),
      })
    )
    .parse(
      await apiFetch<unknown>('/api/v1/rag/documents/lookup', {
        method: 'POST',
        headers: workspaceHeaders(workspaceId),
        body: JSON.stringify({ ids }),
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

/** Opens a Conversation on one document; it draws on that document alone. */
export async function createDocumentRAGConversation(
  workspaceId: string,
  documentId: string
): Promise<RAGConversation> {
  return ragConversationSchema.parse(
    await apiFetch<unknown>('/api/v1/rag/conversations', {
      method: 'POST',
      headers: workspaceHeaders(workspaceId),
      body: JSON.stringify({ documentId }),
    })
  )
}

export async function listDocumentRAGConversations(
  documentId: string,
  signal?: AbortSignal
): Promise<RAGConversation[]> {
  return z
    .array(ragConversationSchema)
    .parse(
      await apiFetch<unknown>(
        `/api/v1/rag/documents/${documentId}/conversations`,
        { signal }
      )
    )
}

/** Approves or declines an action the Agent asked for. */
export async function decideAgentAction(
  conversationID: string,
  actionID: string,
  approve: boolean
): Promise<AgentAction> {
  return agentActionSchema.parse(
    await apiFetch<unknown>(
      `/api/v1/rag/conversations/${conversationID}/actions/${actionID}`,
      { method: 'POST', body: JSON.stringify({ approve }) }
    )
  )
}

export async function listSkills(signal?: AbortSignal): Promise<Skill[]> {
  return z
    .object({ skills: z.array(skillSchema) })
    .parse(await apiFetch<unknown>('/api/v1/skills', { signal })).skills
}

/** Renames, pins, unpins, archives or restores one of the User's chats. */
export async function updateRAGConversation(
  conversationID: string,
  patch: { title?: string; pinned?: boolean; archived?: boolean }
): Promise<RAGConversation> {
  return ragConversationSchema.parse(
    await apiFetch<unknown>(`/api/v1/rag/conversations/${conversationID}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  )
}

/** Records that the User has seen the chat's latest answer. */
export async function markRAGConversationRead(
  conversationID: string
): Promise<void> {
  await apiFetch<void>(`/api/v1/rag/conversations/${conversationID}/read`, {
    method: 'POST',
  })
}

/** The categories the User may narrow a workspace question to. */
export async function listRAGCategories(
  workspaceId: string,
  signal?: AbortSignal
): Promise<RAGCategory[]> {
  return z.array(ragCategorySchema).parse(
    await apiFetch<unknown>('/api/v1/rag/categories', {
      signal,
      headers: workspaceHeaders(workspaceId),
    })
  )
}

/** Tokens the User has used this month in the workspace, and the Plan's limit. */
export async function getRAGUsage(
  workspaceId: string,
  signal?: AbortSignal
): Promise<RAGUsage> {
  return ragUsageSchema.parse(
    await apiFetch<unknown>('/api/v1/rag/usage', {
      signal,
      headers: workspaceHeaders(workspaceId),
    })
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

export async function duplicateDocument(
  workspaceId: string,
  documentId: string,
  requestID: string
): Promise<DocumentItem> {
  return toDocument(
    await apiFetch<unknown>(`/api/v1/documents/${documentId}/duplicate`, {
      method: 'POST',
      headers: {
        ...workspaceHeaders(workspaceId),
        'Idempotency-Key': requestID,
      },
    })
  )
}

export async function moveDocument(
  workspaceId: string,
  documentId: string,
  targetProjectId: string | null
): Promise<void> {
  await apiFetch<unknown>(`/api/v1/documents/${documentId}/move`, {
    method: 'PUT',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify({ targetProjectId }),
  })
}

export async function recordDocumentView(
  workspaceId: string,
  documentId: string
): Promise<void> {
  await apiFetch<unknown>(`/api/v1/documents/${documentId}/view`, {
    method: 'POST',
    headers: workspaceHeaders(workspaceId),
  })
}

export async function addProjectCategory(
  workspaceId: string,
  projectId: string,
  name: string,
  colorId = 'blue'
): Promise<void> {
  await apiFetch<unknown>(`/api/v1/projects/${projectId}/categories`, {
    method: 'POST',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify({ name, colorId }),
  })
}

export async function updateProjectCategory(
  workspaceId: string,
  projectId: string,
  categoryId: string,
  input: { name: string; colorId: string }
): Promise<void> {
  await apiFetch<unknown>(
    `/api/v1/projects/${projectId}/categories/${categoryId}`,
    {
      method: 'PUT',
      headers: workspaceHeaders(workspaceId),
      body: JSON.stringify(input),
    }
  )
}

export async function deleteProjectCategory(
  workspaceId: string,
  projectId: string,
  categoryId: string
): Promise<void> {
  await apiFetch<unknown>(
    `/api/v1/projects/${projectId}/categories/${categoryId}`,
    { method: 'DELETE', headers: workspaceHeaders(workspaceId) }
  )
}

export async function reorderProjectCategories(
  workspaceId: string,
  projectId: string,
  categoryIds: string[]
): Promise<void> {
  await apiFetch<unknown>(`/api/v1/projects/${projectId}/categories/reorder`, {
    method: 'PUT',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify({ categoryIds }),
  })
}

const projectMemberSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(['manager', 'editor', 'viewer']),
  createdAt: z.string(),
  user: z.object({
    id: z.string().min(1),
    name: z.string(),
    email: z.string(),
    avatar: z.string().optional().default(''),
  }),
})

export async function listProjectMembers(
  workspaceId: string,
  projectId: string,
  signal?: AbortSignal
): Promise<ProjectMemberItem[]> {
  return z.array(projectMemberSchema).parse(
    await apiFetch<unknown>(`/api/v1/projects/${projectId}/members`, {
      headers: workspaceHeaders(workspaceId),
      signal,
    })
  )
}

/** Adds the member, or changes the role when they already belong. */
export async function setProjectMember(
  workspaceId: string,
  projectId: string,
  email: string,
  role: ProjectMemberRole
): Promise<void> {
  await apiFetch<unknown>(`/api/v1/projects/${projectId}/members`, {
    method: 'POST',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify({ email, role }),
  })
}

export async function removeProjectMember(
  workspaceId: string,
  projectId: string,
  userId: string
): Promise<void> {
  await apiFetch<unknown>(`/api/v1/projects/${projectId}/members/${userId}`, {
    method: 'DELETE',
    headers: workspaceHeaders(workspaceId),
  })
}

export type UpdateProjectInput = {
  name: string
  description: string
  logoUrl: string
}

export async function updateProject(
  workspaceId: string,
  projectId: string,
  input: UpdateProjectInput
): Promise<void> {
  await apiFetch<unknown>(`/api/v1/projects/${projectId}`, {
    method: 'PUT',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify(input),
  })
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
