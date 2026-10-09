import type {
  DocFilterTab,
  DocType,
  DocumentAccessItem,
  DocumentAccessLevel,
  DocumentItem,
  DocumentRevision,
  OrganizationItem,
  ProjectItem,
  ProjectMemberItem,
  ProjectMemberRole,
  SortField,
  SortOrder,
  TrashItem,
  ViewMode,
  WorkspaceItem,
} from '@/types/dokudocs'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { getUserStorage } from '@/lib/user-storage'
import { invalidateThumbnailCache } from '@/features/docs/components/doc-thumbnail-preview'
import { mockDocuments } from '@/features/docs/data/mock-docs'
import { mockProjects } from '@/features/projects/data/mock-projects'
import { mockTrash } from '@/features/trash/data/mock-trash'

export const defaultWorkspaces: WorkspaceItem[] = [
  {
    id: 'org-1',
    name: 'Dokudocs Workspace',
    plan: 'Pro Workspace',
    role: 'owner',
  },
  {
    id: 'org-2',
    name: 'Personal Workspace',
    plan: 'Free',
    role: 'owner',
  },
  {
    id: 'org-3',
    name: 'Engineering Team',
    plan: 'Enterprise',
    role: 'admin',
  },
]

/** @deprecated Use defaultWorkspaces to match Dokudocs domain ubiquitous language (CONTEXT.md) */
export const defaultOrganizations: OrganizationItem[] = defaultWorkspaces

interface DokudocsState {
  activeOrgId: string
  organizations: WorkspaceItem[]
  projects: ProjectItem[]
  documents: DocumentItem[]
  trash: TrashItem[]
  revisions: Record<string, DocumentRevision[]>
  documentAccesses: Record<string, DocumentAccessItem[]>
  projectMembers: Record<string, ProjectMemberItem[]>

  viewMode: ViewMode
  filterTab: DocFilterTab
  searchQuery: string
  sortField: SortField
  sortOrder: SortOrder

  setActiveOrgId: (orgId: string) => void
  createOrganization: (name: string, plan?: string) => WorkspaceItem
  updateOrganization: (id: string, updates: Partial<WorkspaceItem>) => void
  deleteOrganization: (id: string) => void
  setViewMode: (mode: ViewMode) => void
  setFilterTab: (tab: DocFilterTab) => void
  setSearchQuery: (query: string) => void
  setSorting: (field: SortField, order: SortOrder) => void

  recordDocumentView: (id: string) => void
  createDocument: (payload: {
    title: string
    type: DocType
    projectId?: string | null
    category?: string | null
    categories?: string[]
    content?: string
    contentJSON?: unknown
    isDraft?: boolean
  }) => DocumentItem
  upsertDocument: (document: DocumentItem) => void
  updateDocument: (id: string, updates: Partial<DocumentItem>) => void
  updateDocumentThumbnail: (
    id: string,
    thumbnail: string,
    thumbnailDark?: string
  ) => void
  moveToTrash: (id: string) => void
  restoreFromTrash: (id: string) => void
  permanentDeleteFromTrash: (id: string) => void
  emptyTrash: () => void
  toggleStarDocument: (id: string) => void
  duplicateDocument: (id: string) => DocumentItem
  moveDocumentToProject: (docId: string, targetProjectId: string | null) => void

  updateProject: (id: string, updates: Partial<ProjectItem>) => void
  deleteProject: (id: string) => void
  addProjectCategory: (
    projectId: string,
    category: string,
    colorId?: string
  ) => void
  removeProjectCategory: (projectId: string, category: string) => void
  renameProjectCategory: (
    projectId: string,
    oldCategory: string,
    newCategory: string,
    colorId?: string
  ) => void
  reorderProjectCategories: (projectId: string, newCategories: string[]) => void

  getDocRevisions: (docId: string) => DocumentRevision[]
  createRevisionSnapshot: (
    docId: string,
    title?: string
  ) => DocumentRevision | null
  recordAutoRevision: (docId: string, content: string) => void
  renameRevision: (docId: string, revisionId: string, title: string) => void
  restoreRevision: (docId: string, revisionId: string) => void

  getDocAccesses: (docId: string) => DocumentAccessItem[]
  setDocumentAccess: (
    docId: string,
    email: string,
    accessLevel: DocumentAccessLevel
  ) => void
  removeDocumentAccess: (docId: string, accessId: string) => void

  getProjectMembers: (projectId: string) => ProjectMemberItem[]
  setProjectMember: (
    projectId: string,
    email: string,
    role: ProjectMemberRole
  ) => void
  removeProjectMember: (projectId: string, memberId: string) => void
}

const defaultTemplates: Record<DocType, string> = {
  markdown: `# New Document

## 1. Overview

Describe the service, module, or architecture specification here.

## 2. Requirements & Scope

- Requirement 1
- Requirement 2

## 3. Implementation Details

Details go here...`,

  dbdiagram: `Table users {
  id int [pk, increment]
  email varchar(255) [unique, not null]
  created_at timestamp
}

Table orders {
  id int [pk, increment]
  user_id int [ref: > users.id]
  total decimal(10,2)
  created_at timestamp
}`,

  mermaid: `graph TD
  Start([Start Process]) --> Check{Is Valid?}
  Check -- Yes --> Success[Proceed Success]
  Check -- No --> Error[Show Error State]`,

  // An Architecture document's text is derived from its canvas.
  architecture: '',
}

export function getDefaultDocumentContent(type: DocType) {
  return defaultTemplates[type]
}

function generateUniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

const defaultRevisions: Record<string, DocumentRevision[]> = {
  'doc-1': [
    {
      id: 'rev-2',
      documentId: 'doc-1',
      versionNumber: 2,
      title: 'Order Processing FSD (v2 Requirements Added)',
      isNamed: true,
      content: `# Functional Specification: Order Processing Service\n\n## 1. Overview\nThe Order Processing Service manages cart validation, inventory reservation, payment authorization, and fulfillment dispatch.\n\n## 2. Order States\n- **PENDING**: Order placed.\n- **PAID**: Payment verified.`,
      author: {
        id: 'usr-1',
        name: 'Fikri',
        email: 'fikri@dokudocs.app',
        avatar: '/avatars/01.png',
      },
      createdAt: '2026-08-18T14:20:00.000Z',
      updatedAt: '2026-08-18T14:20:00.000Z',
    },
    {
      id: 'rev-1',
      documentId: 'doc-1',
      versionNumber: 1,
      title: 'Order Processing FSD (v1 Initial Draft)',
      isNamed: true,
      content: `# Functional Specification: Order Processing Service\n\n## 1. Overview\nDraft initial service definition.`,
      author: {
        id: 'usr-1',
        name: 'Fikri',
        email: 'fikri@dokudocs.app',
        avatar: '/avatars/01.png',
      },
      createdAt: '2026-08-16T11:00:00.000Z',
      updatedAt: '2026-08-16T11:00:00.000Z',
    },
  ],
}

const defaultDocumentAccesses: Record<string, DocumentAccessItem[]> = {
  'doc-1': [
    {
      id: 'acc-1',
      documentId: 'doc-1',
      userId: 'usr-2',
      user: {
        id: 'usr-2',
        name: 'Sarah',
        email: 'sarah@dokudocs.app',
        avatar: '/avatars/02.png',
      },
      accessLevel: 'edit',
      createdAt: '2026-08-17T10:00:00.000Z',
    },
    {
      id: 'acc-2',
      documentId: 'doc-1',
      userId: 'usr-3',
      user: {
        id: 'usr-3',
        name: 'Alex',
        email: 'alex@dokudocs.app',
        avatar: '/avatars/03.png',
      },
      accessLevel: 'comment',
      createdAt: '2026-08-18T11:30:00.000Z',
    },
  ],
}

const defaultProjectMembers: Record<string, ProjectMemberItem[]> = {
  'proj-1': [
    {
      id: 'pm-1',
      projectId: 'proj-1',
      userId: 'usr-1',
      user: {
        id: 'usr-1',
        name: 'Fikri',
        email: 'fikri@dokudocs.app',
        avatar: '/avatars/01.png',
      },
      role: 'manager',
      createdAt: '2026-08-10T10:00:00.000Z',
    },
    {
      id: 'pm-2',
      projectId: 'proj-1',
      userId: 'usr-2',
      user: {
        id: 'usr-2',
        name: 'Sarah',
        email: 'sarah@dokudocs.app',
        avatar: '/avatars/02.png',
      },
      role: 'editor',
      createdAt: '2026-08-12T14:30:00.000Z',
    },
    {
      id: 'pm-3',
      projectId: 'proj-1',
      userId: 'usr-3',
      user: {
        id: 'usr-3',
        name: 'Alex',
        email: 'alex@dokudocs.app',
        avatar: '/avatars/03.png',
      },
      role: 'viewer',
      createdAt: '2026-08-14T09:15:00.000Z',
    },
  ],
}

export const useDokudocsStore = create<DokudocsState>()(
  persist(
    (set, get) => ({
      activeOrgId: 'org-1',
      organizations: defaultOrganizations,
      projects: mockProjects,
      documents: mockDocuments,
      trash: mockTrash,
      revisions: defaultRevisions,
      documentAccesses: defaultDocumentAccesses,
      projectMembers: defaultProjectMembers,

      viewMode: 'grid',
      filterTab: 'all',
      searchQuery: '',
      sortField: 'lastViewedAt',
      sortOrder: 'desc',

      setActiveOrgId: (orgId) => set({ activeOrgId: orgId }),
      createOrganization: (name, plan = 'Free') => {
        const newOrg: WorkspaceItem = {
          id: `org-${Date.now()}`,
          name: name.trim(),
          plan,
          role: 'owner',
        }
        set((state) => ({
          organizations: [...(state.organizations || []), newOrg],
          activeOrgId: newOrg.id,
        }))
        return newOrg
      },
      updateOrganization: (id, updates) => {
        set((state) => ({
          organizations: (state.organizations || []).map((org) =>
            org.id === id ? { ...org, ...updates } : org
          ),
        }))
      },
      deleteOrganization: (id) => {
        set((state) => {
          const remaining = (state.organizations || []).filter(
            (org) => org.id !== id
          )
          const nextActiveId =
            state.activeOrgId === id
              ? remaining[0]?.id || 'org-1'
              : state.activeOrgId
          return {
            organizations: remaining,
            activeOrgId: nextActiveId,
          }
        })
      },
      setViewMode: (viewMode) => set({ viewMode }),
      setFilterTab: (filterTab) => set({ filterTab }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setSorting: (sortField, sortOrder) => set({ sortField, sortOrder }),

      recordDocumentView: (id) => {
        const now = new Date().toISOString()
        set((state) => ({
          documents: (state.documents || []).map((doc) =>
            doc.id === id
              ? {
                  ...doc,
                  lastViewedAt: now,
                }
              : doc
          ),
        }))
      },

      createDocument: (payload) => {
        const id = generateUniqueId('doc')
        const activeOrgId = get().activeOrgId
        const project = payload.projectId
          ? get().projects.find((p) => p.id === payload.projectId)
          : null

        const docCategories = payload.categories?.length
          ? payload.categories
          : payload.category
            ? [payload.category]
            : []

        const now = new Date().toISOString()
        const newDoc: DocumentItem = {
          id,
          title: payload.title?.trim() || 'My Draft',
          type: payload.type,
          content: payload.content ?? defaultTemplates[payload.type],
          contentJSON: payload.contentJSON,
          projectId: payload.projectId ?? null,
          projectName: project?.name ?? null,
          category: docCategories[0] ?? null,
          categories: docCategories,
          orgId: activeOrgId,
          author: {
            id: 'usr-1',
            name: 'Fikri',
            email: 'fikri@dokudocs.app',
            avatar: '/avatars/01.png',
          },
          isStarred: false,
          isShared: false,
          isDraft: payload.isDraft ?? !payload.projectId,
          createdAt: now,
          updatedAt: now,
          lastViewedAt: now,
          tags: [],
        }

        set((state) => {
          const updatedDocs = [newDoc, ...(state.documents || [])]
          const updatedProjects = payload.projectId
            ? (state.projects || []).map((p) => {
                if (p.id !== payload.projectId) return p
                const existingCats = p.categories || []
                const newCats = docCategories.filter(
                  (c) => !existingCats.includes(c)
                )
                return {
                  ...p,
                  documentIds: [...(p.documentIds || []), id],
                  categories: [...existingCats, ...newCats],
                }
              })
            : state.projects
          return { documents: updatedDocs, projects: updatedProjects }
        })

        return newDoc
      },

      upsertDocument: (document) => {
        set((state) => ({
          documents: [
            document,
            ...(state.documents || []).filter(
              (item) => item.id !== document.id
            ),
          ],
        }))
      },

      updateDocument: (id, updates) => {
        const now = new Date().toISOString()
        set((state) => ({
          documents: (state.documents || []).map((doc) =>
            doc.id === id
              ? {
                  ...doc,
                  ...updates,
                  updatedAt: now,
                  lastViewedAt: now,
                }
              : doc
          ),
        }))
      },

      updateDocumentThumbnail: (id, thumbnail, thumbnailDark) => {
        invalidateThumbnailCache(id)
        set((state) => ({
          documents: (state.documents || []).map((doc) =>
            doc.id === id
              ? {
                  ...doc,
                  thumbnail,
                  ...(thumbnailDark !== undefined ? { thumbnailDark } : {}),
                }
              : doc
          ),
        }))
      },

      moveToTrash: (id) => {
        const doc = (get().documents || []).find((d) => d.id === id)
        if (!doc) return

        const trashEntry: TrashItem = {
          id: generateUniqueId('trash'),
          docId: doc.id,
          document: { ...doc, deletedAt: new Date().toISOString() },
          deletedAt: new Date().toISOString(),
          deletedBy: {
            id: 'usr-1',
            name: 'Fikri',
            email: 'fikri@dokudocs.app',
            avatar: '/avatars/01.png',
          },
          daysRemaining: 30,
        }

        set((state) => ({
          documents: (state.documents || []).map((d) =>
            d.id === id ? { ...d, deletedAt: new Date().toISOString() } : d
          ),
          trash: [trashEntry, ...(state.trash || [])],
        }))
      },

      restoreFromTrash: (id) => {
        const trashItem = (get().trash || []).find(
          (t) => t.id === id || t.docId === id
        )
        const targetDocId = trashItem ? trashItem.docId : id

        set((state) => ({
          trash: (state.trash || []).filter(
            (t) => t.id !== id && t.docId !== id
          ),
          documents: (state.documents || []).map((d) =>
            d.id === targetDocId ? { ...d, deletedAt: null } : d
          ),
        }))
      },

      permanentDeleteFromTrash: (id) => {
        const trashItem = (get().trash || []).find(
          (t) => t.id === id || t.docId === id
        )
        const targetDocId = trashItem ? trashItem.docId : id
        invalidateThumbnailCache(targetDocId)
        set((state) => ({
          trash: (state.trash || []).filter(
            (t) => t.id !== id && t.docId !== id
          ),
          documents: (state.documents || []).filter(
            (d) => d.id !== targetDocId
          ),
        }))
      },

      emptyTrash: () => {
        invalidateThumbnailCache()
        const trashDocIds = (get().trash || []).map((t) => t.docId)
        set((state) => ({
          trash: [],
          documents: (state.documents || []).filter(
            (d) => !trashDocIds.includes(d.id)
          ),
        }))
      },

      toggleStarDocument: (id) => {
        set((state) => ({
          documents: (state.documents || []).map((d) => {
            if (d.id !== id) return d
            const nextStarred = !d.isStarred
            return {
              ...d,
              isStarred: nextStarred,
              starredAt: nextStarred ? new Date().toISOString() : null,
            }
          }),
        }))
      },

      duplicateDocument: (id) => {
        const doc = (get().documents || []).find((d) => d.id === id)
        if (!doc) throw new Error('Document not found')

        const newId = generateUniqueId('doc')
        const duplicated: DocumentItem = {
          ...doc,
          id: newId,
          title: `${doc.title} (Copy)`,
          createdAt: new Date().toISOString(),
          updatedAt: 'Just now',
          isStarred: false,
        }

        set((state) => ({
          documents: [duplicated, ...(state.documents || [])],
          projects: doc.projectId
            ? (state.projects || []).map((p) =>
                p.id === doc.projectId
                  ? { ...p, documentIds: [...(p.documentIds || []), newId] }
                  : p
              )
            : state.projects,
        }))

        return duplicated
      },

      moveDocumentToProject: (docId, targetProjectId) => {
        const doc = (get().documents || []).find((d) => d.id === docId)
        if (!doc) return

        const oldProjectId = doc.projectId
        const targetProj = targetProjectId
          ? (get().projects || []).find((p) => p.id === targetProjectId)
          : null

        set((state) => ({
          documents: (state.documents || []).map((d) =>
            d.id === docId
              ? {
                  ...d,
                  projectId: targetProjectId,
                  projectName: targetProj ? targetProj.name : null,
                  isDraft: !targetProjectId,
                  updatedAt: 'Just now',
                }
              : d
          ),
          projects: (state.projects || []).map((p) => {
            if (p.id === oldProjectId && p.id !== targetProjectId) {
              return {
                ...p,
                documentIds: (p.documentIds || []).filter((id) => id !== docId),
              }
            }
            if (p.id === targetProjectId && p.id !== oldProjectId) {
              const docCategories =
                doc.categories || (doc.category ? [doc.category] : [])
              const existingCats = p.categories || []
              const newCats = docCategories.filter(
                (c) => !existingCats.includes(c)
              )
              return {
                ...p,
                documentIds: [...(p.documentIds || []), docId],
                categories: [...existingCats, ...newCats],
              }
            }
            return p
          }),
        }))
      },

      updateProject: (id, updates) => {
        set((state) => ({
          projects: (state.projects || []).map((p) =>
            p.id === id ? { ...p, ...updates, updatedAt: 'Just now' } : p
          ),
        }))
      },

      deleteProject: (id) => {
        set((state) => ({
          projects: (state.projects || []).filter((p) => p.id !== id),
          documents: (state.documents || []).map((d) =>
            d.projectId === id
              ? { ...d, projectId: null, projectName: null, isDraft: true }
              : d
          ),
        }))
      },

      addProjectCategory: (projectId, category, colorId) => {
        const trimmed = category.trim()
        if (!trimmed) return

        set((state) => ({
          projects: (state.projects || []).map((p) => {
            if (p.id !== projectId) return p
            const existing = p.categories ?? []
            if (existing.includes(trimmed)) return p

            const colors = { ...(p.categoryColors ?? {}) }
            colors[trimmed] = colorId || 'blue'

            return {
              ...p,
              categories: [...existing, trimmed],
              categoryColors: colors,
              updatedAt: 'Just now',
            }
          }),
        }))
      },

      removeProjectCategory: (projectId, category) => {
        set((state) => ({
          projects: (state.projects || []).map((p) => {
            if (p.id !== projectId) return p
            const colors = { ...(p.categoryColors ?? {}) }
            delete colors[category]
            return {
              ...p,
              categories: (p.categories ?? []).filter((c) => c !== category),
              categoryColors: colors,
              updatedAt: 'Just now',
            }
          }),
          documents: (state.documents || []).map((d) => {
            if (d.projectId === projectId && d.category === category) {
              return { ...d, category: null }
            }
            return d
          }),
        }))
      },

      renameProjectCategory: (projectId, oldCategory, newCategory, colorId) => {
        const trimmed = newCategory.trim()
        if (!trimmed) return

        set((state) => ({
          projects: (state.projects || []).map((p) => {
            if (p.id !== projectId) return p
            const colors = { ...(p.categoryColors ?? {}) }
            const assignedColor = colorId || colors[oldCategory] || 'blue'
            delete colors[oldCategory]
            colors[trimmed] = assignedColor

            return {
              ...p,
              categories: (p.categories ?? []).map((c) =>
                c === oldCategory ? trimmed : c
              ),
              categoryColors: colors,
              updatedAt: 'Just now',
            }
          }),
          documents: (state.documents || []).map((d) => {
            if (d.projectId === projectId && d.category === oldCategory) {
              return { ...d, category: trimmed }
            }
            return d
          }),
        }))
      },

      reorderProjectCategories: (projectId, newCategories) => {
        set((state) => ({
          projects: (state.projects || []).map((p) => {
            if (p.id !== projectId) return p
            return {
              ...p,
              categories: newCategories,
              updatedAt: 'Just now',
            }
          }),
        }))
      },

      getDocRevisions: (docId) => {
        return get().revisions[docId] || []
      },
      createRevisionSnapshot: (docId, title) => {
        const doc = (get().documents || []).find((d) => d.id === docId)
        if (!doc) return null
        const currentRevisions = get().revisions[docId] || []
        const nextVersion = currentRevisions.length + 1
        const nowIso = new Date().toISOString()
        const newRev: DocumentRevision = {
          id: generateUniqueId('rev'),
          documentId: docId,
          versionNumber: nextVersion,
          title: title?.trim() || `${doc.title} (v${nextVersion})`,
          isNamed: true,
          content: doc.content,
          author: doc.author,
          createdAt: nowIso,
          updatedAt: nowIso,
        }
        set((state) => ({
          revisions: {
            ...state.revisions,
            [docId]: [newRev, ...(state.revisions[docId] || [])],
          },
        }))
        return newRev
      },

      recordAutoRevision: (docId, content) => {
        const doc = (get().documents || []).find((d) => d.id === docId)
        if (!doc) return
        const currentRevisions = get().revisions[docId] || []
        const latest = currentRevisions[0]
        const now = new Date()
        const nowIso = now.toISOString()
        const SESSION_WINDOW_MS = 10 * 60 * 1000 // 10 minutes

        // Coalesce in-place if latest revision is an unnamed auto-save within 10 min window
        if (latest && !latest.isNamed) {
          const lastTime = new Date(
            latest.updatedAt || latest.createdAt
          ).getTime()
          if (now.getTime() - lastTime < SESSION_WINDOW_MS) {
            set((state) => ({
              revisions: {
                ...state.revisions,
                [docId]: (state.revisions[docId] || []).map((r, i) =>
                  i === 0 ? { ...r, content, updatedAt: nowIso } : r
                ),
              },
            }))
            return
          }
        }

        // Avoid duplicate revision if content hasn't changed from latest
        if (latest && latest.content === content) {
          return
        }

        // Otherwise create new revision entry for this editing session
        const nextVersion = currentRevisions.length + 1
        const newRev: DocumentRevision = {
          id: generateUniqueId('rev'),
          documentId: docId,
          versionNumber: nextVersion,
          title: null,
          isNamed: false,
          content,
          author: doc.author,
          createdAt: nowIso,
          updatedAt: nowIso,
        }
        set((state) => ({
          revisions: {
            ...state.revisions,
            [docId]: [newRev, ...(state.revisions[docId] || [])],
          },
        }))
      },

      renameRevision: (docId, revisionId, title) => {
        const cleanTitle = title.trim()
        set((state) => ({
          revisions: {
            ...state.revisions,
            [docId]: (state.revisions[docId] || []).map((r) =>
              r.id === revisionId
                ? {
                    ...r,
                    title: cleanTitle || null,
                    isNamed: Boolean(cleanTitle),
                  }
                : r
            ),
          },
        }))
      },

      restoreRevision: (docId, revisionId) => {
        const doc = (get().documents || []).find((d) => d.id === docId)
        const rev = (get().revisions[docId] || []).find(
          (r) => r.id === revisionId
        )
        if (!doc || !rev) return

        const currentRevisions = get().revisions[docId] || []
        const nowIso = new Date().toISOString()
        const nextVersion = currentRevisions.length + 1

        const restoredRev: DocumentRevision = {
          id: generateUniqueId('rev'),
          documentId: docId,
          versionNumber: nextVersion,
          title: `Restored to v${rev.versionNumber}`,
          isNamed: true,
          content: rev.content,
          author: doc.author,
          createdAt: nowIso,
          updatedAt: nowIso,
        }

        set((state) => ({
          documents: (state.documents || []).map((d) =>
            d.id === docId
              ? {
                  ...d,
                  content: rev.content,
                  updatedAt: nowIso,
                }
              : d
          ),
          revisions: {
            ...state.revisions,
            [docId]: [restoredRev, ...(state.revisions[docId] || [])],
          },
        }))
      },

      getDocAccesses: (docId) => {
        return get().documentAccesses[docId] || []
      },
      setDocumentAccess: (docId, email, accessLevel) => {
        const trimmed = email.trim().toLowerCase()
        if (!trimmed) return
        const existing = get().documentAccesses[docId] || []
        const found = existing.find(
          (a) => a.user.email.toLowerCase() === trimmed
        )
        if (found) {
          set((state) => ({
            documentAccesses: {
              ...state.documentAccesses,
              [docId]: existing.map((a) =>
                a.id === found.id ? { ...a, accessLevel } : a
              ),
            },
          }))
          return
        }
        const namePart = trimmed.split('@')[0]
        const displayName = namePart.charAt(0).toUpperCase() + namePart.slice(1)
        const newAccess: DocumentAccessItem = {
          id: generateUniqueId('acc'),
          documentId: docId,
          userId: generateUniqueId('usr'),
          user: {
            id: generateUniqueId('usr'),
            name: displayName,
            email: trimmed,
            avatar: `/avatars/0${(existing.length % 5) + 1}.png`,
          },
          accessLevel,
          createdAt: new Date().toISOString(),
        }
        set((state) => ({
          documentAccesses: {
            ...state.documentAccesses,
            [docId]: [...existing, newAccess],
          },
        }))
      },
      removeDocumentAccess: (docId, accessId) => {
        set((state) => ({
          documentAccesses: {
            ...state.documentAccesses,
            [docId]: (state.documentAccesses[docId] || []).filter(
              (a) => a.id !== accessId
            ),
          },
        }))
      },

      getProjectMembers: (projectId) => {
        return get().projectMembers[projectId] || []
      },
      setProjectMember: (projectId, email, role) => {
        const trimmed = email.trim().toLowerCase()
        if (!trimmed) return
        const existing = get().projectMembers[projectId] || []
        const found = existing.find(
          (m) => m.user.email.toLowerCase() === trimmed
        )
        if (found) {
          set((state) => ({
            projectMembers: {
              ...state.projectMembers,
              [projectId]: existing.map((m) =>
                m.id === found.id ? { ...m, role } : m
              ),
            },
          }))
          return
        }
        const namePart = trimmed.split('@')[0]
        const displayName = namePart.charAt(0).toUpperCase() + namePart.slice(1)
        const newMember: ProjectMemberItem = {
          id: generateUniqueId('pm'),
          projectId,
          userId: generateUniqueId('usr'),
          user: {
            id: generateUniqueId('usr'),
            name: displayName,
            email: trimmed,
            avatar: `/avatars/0${(existing.length % 5) + 1}.png`,
          },
          role,
          createdAt: new Date().toISOString(),
        }
        set((state) => ({
          projectMembers: {
            ...state.projectMembers,
            [projectId]: [...existing, newMember],
          },
        }))
      },
      removeProjectMember: (projectId, memberId) => {
        set((state) => ({
          projectMembers: {
            ...state.projectMembers,
            [projectId]: (state.projectMembers[projectId] || []).filter(
              (m) => m.id !== memberId
            ),
          },
        }))
      },
    }),
    {
      name: 'dokudocs-workspace-storage',
      storage: createJSONStorage(() => getUserStorage()),
      version: 2,
      migrate: (persistedState: unknown, version: number) => {
        const state = (persistedState as Partial<DokudocsState>) || {}
        const docs = (state.documents || []).map((doc) => ({
          ...doc,
          lastViewedAt: doc.lastViewedAt || doc.updatedAt || doc.createdAt,
        }))
        return {
          ...state,
          documents: docs,
          sortField:
            version < 2 || state.sortField === 'updatedAt'
              ? 'lastViewedAt'
              : state.sortField || 'lastViewedAt',
          sortOrder: state.sortOrder || 'desc',
        }
      },
    }
  )
)
