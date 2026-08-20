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
  thumbnailPreview?: string
  tags?: string[]
}

export interface ProjectItem {
  id: string
  name: string
  description?: string
  logoUrl?: string
  categories?: string[]
  categoryColors?: Record<string, string>
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

export interface OrganizationItem {
  id: string
  name: string
  plan: string
  avatar?: string
  role: 'owner' | 'admin' | 'member'
}

export interface TrashItem {
  id: string
  docId: string
  document: DocumentItem
  deletedAt: string
  deletedBy: UserAuthor
  daysRemaining: number
}
