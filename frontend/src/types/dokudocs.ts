export type DocType = 'markdown' | 'dbdiagram' | 'mermaid'

export type DocFilterTab = 'all' | 'created_by_me' | 'shared' | 'starred'

export type ViewMode = 'grid' | 'list'

export type SortField = 'lastViewedAt' | 'updatedAt' | 'createdAt' | 'title'

export type SortOrder = 'asc' | 'desc'

export interface UserAuthor {
  id: string
  name: string
  email: string
  avatar: string
}

export interface DocumentItem {
  id: string
  title: string
  type: DocType
  content: string
  projectId?: string | null
  projectName?: string | null
  category?: string | null
  categories?: string[]
  workspaceId?: string
  orgId: string
  author: UserAuthor
  isStarred: boolean
  starredAt?: string | null
  isShared: boolean
  isDraft?: boolean
  createdAt: string
  updatedAt: string
  lastViewedAt?: string | null
  deletedAt?: string | null
  thumbnail?: string | null
  thumbnailDark?: string | null
  thumbnailPreview?: string
  thumbnailPreviewDark?: string
  tags?: string[]
}

export interface ProjectItem {
  id: string
  name: string
  description?: string
  logoUrl?: string
  categories?: string[]
  categoryColors?: Record<string, string>
  workspaceId?: string
  orgId: string
  colorBadge?: string
  isStarred?: boolean
  starredAt?: string | null
  documentIds: string[]
  createdAt: string
  updatedAt: string
}

export interface ProjectWithDocuments extends ProjectItem {
  documents: DocumentItem[]
  totalDocsCount: number
}

export interface WorkspaceItem {
  id: string
  name: string
  plan: string
  avatar?: string
  type?: string
  role: 'owner' | 'admin' | 'member'
}

/** @deprecated Use WorkspaceItem to match Dokudocs domain ubiquitous language (CONTEXT.md) */
export type OrganizationItem = WorkspaceItem

export interface TrashItem {
  id: string
  docId: string
  document: DocumentItem
  deletedAt: string
  deletedBy: UserAuthor
  daysRemaining: number
}

export interface DocumentRevision {
  id: string
  documentId: string
  authorId?: string
  versionNumber: number
  title?: string | null
  isNamed?: boolean
  content: string
  astSnapshot?: {
    documentID: string
    rootNodeID: string
    nodes: Array<{
      nodeID: string
      parentID: string | null
      siblingOrder: number
      type: string
      content: string
      attributes: Record<string, unknown>
      version: number
    }>
  }
  bodyVersion?: number
  bodySchemaVersion?: number
  author?: UserAuthor
  createdAt: string
  updatedAt?: string
}

export type DocumentAccessLevel = 'owner' | 'edit' | 'comment' | 'view'

export interface DocumentAccessItem {
  id: string
  documentId: string
  userId: string
  user: UserAuthor
  accessLevel: DocumentAccessLevel
  createdAt: string
}

export type ProjectMemberRole = 'manager' | 'editor' | 'viewer'

export interface ProjectMemberItem {
  id: string
  projectId: string
  userId: string
  user: UserAuthor
  role: ProjectMemberRole
  createdAt: string
}
