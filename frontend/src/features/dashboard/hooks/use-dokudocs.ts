import { useMemo } from 'react'
import { defaultOrganizations, useDokudocsStore } from '@/stores/dokudocs-store'
import { ProjectWithDocuments } from '@/types/dokudocs'

export function useDokudocs() {
  const store = useDokudocsStore()

  const activeOrg = useMemo(() => {
    const orgs = store.organizations?.length ? store.organizations : defaultOrganizations
    return orgs.find((org) => org.id === store.activeOrgId) || orgs[0]
  }, [store.organizations, store.activeOrgId])

  const activeDocuments = useMemo(() => {
    const docs = store.documents || []
    return docs
      .filter((doc) => {
        if (doc.orgId !== store.activeOrgId) return false
        if (doc.deletedAt) return false

        if (store.searchQuery && store.searchQuery.trim()) {
          const q = store.searchQuery.toLowerCase()
          const docCats = doc.categories?.length
            ? doc.categories
            : doc.category
            ? [doc.category]
            : []
          const matchTitle = doc.title?.toLowerCase().includes(q)
          const matchProject = doc.projectName?.toLowerCase().includes(q)
          const matchTags = doc.tags?.some((t) => t.toLowerCase().includes(q))
          const matchCategory = docCats.some((c) =>
            c.toLowerCase().includes(q)
          )
          if (!matchTitle && !matchProject && !matchTags && !matchCategory)
            return false
        }

        if (store.filterTab === 'starred') return doc.isStarred
        if (store.filterTab === 'created_by_me') return doc.author?.id === 'usr-1'
        if (store.filterTab === 'shared') return doc.isShared
        return true
      })
      .sort((a, b) => {
        if (store.sortField === 'title') {
          return store.sortOrder === 'asc'
            ? (a.title || '').localeCompare(b.title || '')
            : (b.title || '').localeCompare(a.title || '')
        }
        if (store.sortField === 'createdAt') {
          const aTime = new Date(a.createdAt).getTime()
          const bTime = new Date(b.createdAt).getTime()
          const validATime = isNaN(aTime) ? 0 : aTime
          const validBTime = isNaN(bTime) ? 0 : bTime
          return store.sortOrder === 'asc'
            ? validATime - validBTime
            : validBTime - validATime
        }

        const getDocTime = (doc: typeof a) => {
          const viewedTime = doc.lastViewedAt ? new Date(doc.lastViewedAt).getTime() : 0
          const updatedTime = doc.updatedAt ? new Date(doc.updatedAt).getTime() : 0
          const createdTime = doc.createdAt ? new Date(doc.createdAt).getTime() : 0
          const validViewed = isNaN(viewedTime) ? 0 : viewedTime
          const validUpdated = isNaN(updatedTime) ? 0 : updatedTime
          const validCreated = isNaN(createdTime) ? 0 : createdTime
          return Math.max(validViewed, validUpdated, validCreated)
        }

        const aTime = getDocTime(a)
        const bTime = getDocTime(b)
        return store.sortOrder === 'asc'
          ? aTime - bTime
          : bTime - aTime
      })
  }, [
    store.documents,
    store.activeOrgId,
    store.searchQuery,
    store.filterTab,
    store.sortField,
    store.sortOrder,
  ])

  const projectsWithDocs: ProjectWithDocuments[] = useMemo(() => {
    const projs = store.projects || []
    const docs = store.documents || []

    return projs
      .filter((project) => project.orgId === store.activeOrgId)
      .map((project) => {
        const projectDocs = docs.filter(
          (doc) => doc.projectId === project.id && !doc.deletedAt
        )
        return {
          ...project,
          documents: projectDocs,
          totalDocsCount: projectDocs.length,
        }
      })
  }, [store.projects, store.documents, store.activeOrgId])

  return {
    ...store,
    activeOrg,
    activeDocuments,
    projectsWithDocs,
  }
}
