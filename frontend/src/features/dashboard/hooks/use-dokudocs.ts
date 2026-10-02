import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type {
  DocumentItem,
  ProjectItem,
  ProjectWithDocuments,
} from '@/types/dokudocs'
import { useAuthStore } from '@/stores/auth-store'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { listDocuments, listProjects } from '@/lib/domain-api'
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces'

const emptyDocuments: DocumentItem[] = []
const emptyProjects: ProjectItem[] = []

export function useDokudocs() {
  const store = useDokudocsStore()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const {
    activeWorkspace,
    activeWorkspaceId,
    isLoading: workspacesLoading,
    error: workspaceError,
  } = useWorkspaces()
  const projectsQuery = useQuery({
    queryKey: ['projects', activeWorkspaceId],
    queryFn: ({ signal }) => listProjects(activeWorkspaceId, signal),
    enabled: Boolean(activeWorkspaceId),
  })
  const documentsQuery = useQuery({
    queryKey: ['documents', activeWorkspaceId],
    queryFn: ({ signal }) => listDocuments(activeWorkspaceId, {}, signal),
    enabled: Boolean(activeWorkspaceId),
  })
  const projects = projectsQuery.data ?? emptyProjects
  const documents = documentsQuery.data ?? emptyDocuments

  const activeDocuments = useMemo(() => {
    return documents
      .filter((doc) => {
        if (doc.deletedAt) return false

        if (store.searchQuery.trim()) {
          const q = store.searchQuery.toLowerCase()
          const docCats = doc.categories?.length
            ? doc.categories
            : doc.category
              ? [doc.category]
              : []
          const matchTitle = doc.title.toLowerCase().includes(q)
          const matchProject = doc.projectName?.toLowerCase().includes(q)
          const matchTags = doc.tags?.some((tag) =>
            tag.toLowerCase().includes(q)
          )
          const matchCategory = docCats.some((category) =>
            category.toLowerCase().includes(q)
          )
          if (!matchTitle && !matchProject && !matchTags && !matchCategory)
            return false
        }

        if (store.filterTab === 'starred') return doc.isStarred
        if (store.filterTab === 'created_by_me') return doc.author.id === userId
        if (store.filterTab === 'shared') return doc.isShared
        return true
      })
      .sort((a, b) => {
        if (store.sortField === 'title') {
          return store.sortOrder === 'asc'
            ? a.title.localeCompare(b.title)
            : b.title.localeCompare(a.title)
        }
        if (store.sortField === 'createdAt') {
          const aTime = Date.parse(a.createdAt) || 0
          const bTime = Date.parse(b.createdAt) || 0
          return store.sortOrder === 'asc' ? aTime - bTime : bTime - aTime
        }

        const getDocTime = (doc: (typeof documents)[number]) =>
          Math.max(
            Date.parse(doc.lastViewedAt ?? '') || 0,
            Date.parse(doc.updatedAt) || 0,
            Date.parse(doc.createdAt) || 0
          )
        const aTime = getDocTime(a)
        const bTime = getDocTime(b)
        return store.sortOrder === 'asc' ? aTime - bTime : bTime - aTime
      })
  }, [
    documents,
    store.searchQuery,
    store.filterTab,
    store.sortField,
    store.sortOrder,
    userId,
  ])

  const projectsWithDocs: ProjectWithDocuments[] = useMemo(
    () =>
      projects.map((project) => {
        const projectDocs = documents.filter(
          (doc) => doc.projectId === project.id && !doc.deletedAt
        )
        return {
          ...project,
          documents: projectDocs,
          totalDocsCount: projectDocs.length,
        }
      }),
    [projects, documents]
  )

  return {
    ...store,
    activeOrgId: activeWorkspaceId,
    activeOrg: activeWorkspace,
    currentUserId: userId,
    documents,
    projects,
    activeDocuments,
    projectsWithDocs,
    isLoading:
      workspacesLoading || projectsQuery.isLoading || documentsQuery.isLoading,
    error: workspaceError ?? projectsQuery.error ?? documentsQuery.error,
    refetch: async () => {
      await Promise.all([projectsQuery.refetch(), documentsQuery.refetch()])
    },
  }
}
