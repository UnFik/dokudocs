import {
  DocFilterTab,
  DocType,
  DocumentItem,
  OrganizationItem,
  ProjectItem,
  SortField,
  SortOrder,
  TrashItem,
  ViewMode,
} from '@/types/dokudocs'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { invalidateThumbnailCache } from '@/features/docs/components/doc-thumbnail-preview'
import { mockDocuments } from '@/features/docs/data/mock-docs'
import { mockProjects } from '@/features/projects/data/mock-projects'
import { mockTrash } from '@/features/trash/data/mock-trash'

export const defaultOrganizations: OrganizationItem[] = [
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

interface DokudocsState {
  activeOrgId: string
  organizations: OrganizationItem[]
  projects: ProjectItem[]
  documents: DocumentItem[]
  trash: TrashItem[]

  viewMode: ViewMode
  filterTab: DocFilterTab
  searchQuery: string
  sortField: SortField
  sortOrder: SortOrder

  setActiveOrgId: (orgId: string) => void
  createOrganization: (name: string, plan?: string) => OrganizationItem
  updateOrganization: (id: string, updates: Partial<OrganizationItem>) => void
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
    isDraft?: boolean
  }) => DocumentItem
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

  createProject: (
    name: string,
    description?: string,
    logoUrl?: string,
    categories?: string[]
  ) => ProjectItem
  updateProject: (id: string, updates: Partial<ProjectItem>) => void
  deleteProject: (id: string) => void
  toggleStarProject: (id: string) => void
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
}

function generateUniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export const useDokudocsStore = create<DokudocsState>()(
  persist(
    (set, get) => ({
      activeOrgId: 'org-1',
      organizations: defaultOrganizations,
      projects: mockProjects,
      documents: mockDocuments,
      trash: mockTrash,

      viewMode: 'grid',
      filterTab: 'all',
      searchQuery: '',
      sortField: 'lastViewedAt',
      sortOrder: 'desc',

      setActiveOrgId: (orgId) => set({ activeOrgId: orgId }),
      createOrganization: (name, plan = 'Free') => {
        const newOrg: OrganizationItem = {
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

      createProject: (name, description, logoUrl, categories) => {
        const id = generateUniqueId('proj')
        const activeOrgId = get().activeOrgId

        const newProject: ProjectItem = {
          id,
          name,
          description,
          logoUrl,
          categories: categories ?? ['General'],
          categoryColors: { General: 'blue' },
          orgId: activeOrgId,
          isStarred: false,
          documentIds: [],
          createdAt: new Date().toISOString(),
          updatedAt: 'Just now',
        }

        set((state) => ({
          projects: [newProject, ...(state.projects || [])],
        }))

        return newProject
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

      toggleStarProject: (id) => {
        set((state) => ({
          projects: (state.projects || []).map((p) => {
            if (p.id !== id) return p
            const nextStarred = !p.isStarred
            return {
              ...p,
              isStarred: nextStarred,
              starredAt: nextStarred ? new Date().toISOString() : null,
            }
          }),
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
    }),
    {
      name: 'dokudocs-workspace-storage',
      storage: createJSONStorage(() => localStorage),
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
