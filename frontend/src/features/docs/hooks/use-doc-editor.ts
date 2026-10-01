import { useCallback, useRef, useState } from 'react'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { getDocCategories } from '@/lib/doc-category-utils'
import {
  getLocalUserScope,
  isLocalUserScopeCurrent,
  registerLocalUserFlush,
} from '@/lib/user-storage'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { generateDualThumbnailsAsync } from '../lib/doc-thumbnail-generator'
import { flushEditorWidgets } from '../lib/editor-flush'

interface EditorState {
  title: string
  content: string
  projectId: string | null
  categories: string[]
}

export function useDocEditor(docId: string) {
  const [scope] = useState(getLocalUserScope)
  const thumbnailVersion = useRef(0)
  const updateDocument = useDokudocsStore((s) => s.updateDocument)
  const recordAutoRevision = useDokudocsStore((s) => s.recordAutoRevision)
  const updateDocumentThumbnail = useDokudocsStore(
    (s) => s.updateDocumentThumbnail
  )
  const recordDocumentView = useDokudocsStore((s) => s.recordDocumentView)
  const projects = useDokudocsStore((s) => s.projects)
  const doc = useDokudocsStore(
    useCallback((s) => s.documents.find((d) => d.id === docId), [docId])
  )

  const [prevDocId, setPrevDocId] = useState(docId)
  const [title, setTitle] = useState(doc?.title ?? '')
  const [content, setContent] = useState(doc?.content ?? '')
  const [projectId, setProjectId] = useState<string | null>(
    doc?.projectId ?? null
  )
  const [categories, setCategories] = useState<string[]>(() =>
    getDocCategories(doc)
  )
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDirtyRef = useRef(false)
  const latestStateRef = useRef<EditorState | null>(null)

  if (docId !== prevDocId) {
    setPrevDocId(docId)
    setTitle(doc?.title ?? '')
    setContent(doc?.content ?? '')
    setProjectId(doc?.projectId ?? null)
    setCategories(getDocCategories(doc))
    setIsDirty(false)
    latestStateRef.current = null
    isDirtyRef.current = false
    thumbnailVersion.current += 1
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
  }

  useMountEffect(() => {
    if (!isLocalUserScopeCurrent(scope)) return
    if (docId) {
      recordDocumentView(docId)
    }

    if (doc && !doc.thumbnail) {
      const version = thumbnailVersion.current
      void generateDualThumbnailsAsync(doc.type, doc.content, doc.id)
        .then((thumb) => {
          if (
            !isLocalUserScopeCurrent(scope) ||
            version !== thumbnailVersion.current
          )
            return
          if (thumb.thumbnail || thumb.thumbnailDark) {
            updateDocumentThumbnail(
              doc.id,
              thumb.thumbnail,
              thumb.thumbnailDark
            )
          }
        })
        .catch(() => {})
    }

    const flush = () => {
      flushEditorWidgets(scope)
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      if (!isLocalUserScopeCurrent(scope)) return
      if (isDirtyRef.current && latestStateRef.current) {
        const store = useDokudocsStore.getState()
        const currentDoc = store.documents.find((d) => d.id === docId)
        if (currentDoc) {
          const stateToSave = latestStateRef.current
          const targetProject = store.projects.find(
            (p) => p.id === stateToSave.projectId
          )
          const currentTitle = stateToSave.title.trim() || 'Untitled Document'

          store.updateDocument(currentDoc.id, {
            title: currentTitle,
            content: stateToSave.content,
            projectId: stateToSave.projectId ?? null,
            projectName: targetProject?.name ?? null,
            categories: stateToSave.categories,
            category: stateToSave.categories[0] ?? null,
            isDraft: !stateToSave.projectId,
            thumbnail: currentDoc.thumbnail,
            thumbnailDark: currentDoc.thumbnailDark,
          })
          store.recordAutoRevision(currentDoc.id, stateToSave.content)
          isDirtyRef.current = false
        }
      }
    }
    const unregister = registerLocalUserFlush(flush)
    return () => {
      unregister()
      thumbnailVersion.current += 1
      flush()
    }
  })

  const performSave = useCallback(
    async (stateToSave: EditorState) => {
      if (!doc || !isLocalUserScopeCurrent(scope)) return
      const version = thumbnailVersion.current
      setIsSaving(true)
      const targetProject = projects.find((p) => p.id === stateToSave.projectId)
      const currentTitle = stateToSave.title.trim() || 'Untitled Document'

      updateDocument(doc.id, {
        title: currentTitle,
        content: stateToSave.content,
        projectId: stateToSave.projectId ?? null,
        projectName: targetProject?.name ?? null,
        categories: stateToSave.categories,
        category: stateToSave.categories[0] ?? null,
        isDraft: !stateToSave.projectId,
      })
      recordAutoRevision(doc.id, stateToSave.content)
      setIsDirty(false)
      isDirtyRef.current = false
      setLastSaved(new Date())

      try {
        const thumb = await generateDualThumbnailsAsync(
          doc.type,
          stateToSave.content,
          doc.id
        )
        if (
          !isLocalUserScopeCurrent(scope) ||
          version !== thumbnailVersion.current
        )
          return
        updateDocumentThumbnail(
          doc.id,
          thumb.thumbnail || doc.thumbnail || '',
          thumb.thumbnailDark || doc.thumbnailDark || ''
        )
      } finally {
        if (
          isLocalUserScopeCurrent(scope) &&
          version === thumbnailVersion.current
        ) {
          setIsSaving(false)
        }
      }
    },
    [
      doc,
      scope,
      projects,
      updateDocument,
      recordAutoRevision,
      updateDocumentThumbnail,
    ]
  )

  const triggerAutoSave = useCallback(
    (nextState: EditorState) => {
      thumbnailVersion.current += 1
      latestStateRef.current = nextState
      isDirtyRef.current = true
      setIsDirty(true)

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }

      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null
        void performSave(nextState).catch(() => {})
      }, 1000)
    },
    [performSave]
  )

  const handleSetContent = useCallback(
    (newContent: string) => {
      if (!isLocalUserScopeCurrent(scope)) return
      setContent(newContent)
      updateDocument(docId, { content: newContent })
      triggerAutoSave({
        ...(latestStateRef.current ?? { title, content, projectId, categories }),
        content: newContent,
      })
    },
    [
      docId,
      scope,
      updateDocument,
      title,
      content,
      projectId,
      categories,
      triggerAutoSave,
    ]
  )

  const handleSetTitle = useCallback(
    (newTitle: string) => {
      if (!isLocalUserScopeCurrent(scope)) return
      setTitle(newTitle)
      updateDocument(docId, { title: newTitle.trim() || 'Untitled Document' })
      triggerAutoSave({
        ...(latestStateRef.current ?? { title, content, projectId, categories }),
        title: newTitle,
      })
    },
    [
      docId,
      scope,
      updateDocument,
      title,
      content,
      projectId,
      categories,
      triggerAutoSave,
    ]
  )

  const handleSetProjectId = useCallback(
    (newProjectId: string | null) => {
      if (!isLocalUserScopeCurrent(scope)) return
      setProjectId(newProjectId)
      const targetProject = projects.find((p) => p.id === newProjectId)
      updateDocument(docId, {
        projectId: newProjectId,
        projectName: targetProject?.name ?? null,
        isDraft: !newProjectId,
      })
      triggerAutoSave({
        ...(latestStateRef.current ?? { title, content, projectId, categories }),
        projectId: newProjectId,
      })
    },
    [
      docId,
      scope,
      projects,
      updateDocument,
      title,
      content,
      projectId,
      categories,
      triggerAutoSave,
    ]
  )

  const handleSetCategories = useCallback(
    (newCategories: string[]) => {
      if (!isLocalUserScopeCurrent(scope)) return
      setCategories(newCategories)
      updateDocument(docId, {
        categories: newCategories,
        category: newCategories[0] ?? null,
      })
      triggerAutoSave({
        ...(latestStateRef.current ?? { title, content, projectId, categories }),
        categories: newCategories,
      })
    },
    [docId, scope, updateDocument, title, content, projectId, categories, triggerAutoSave]
  )

  const handleSetCategory = useCallback(
    (newCategory: string | null) => {
      if (!isLocalUserScopeCurrent(scope)) return
      const nextCategories = newCategory ? [newCategory] : []
      setCategories(nextCategories)
      updateDocument(docId, {
        categories: nextCategories,
        category: newCategory,
      })
      triggerAutoSave({
        ...(latestStateRef.current ?? { title, content, projectId, categories }),
        categories: nextCategories,
      })
    },
    [docId, scope, updateDocument, title, content, projectId, categories, triggerAutoSave]
  )

  return {
    document: doc,
    title,
    content,
    projectId,
    category: categories[0] ?? null,
    categories,
    isDirty,
    isSaving,
    lastSaved,
    setTitle: handleSetTitle,
    setContent: handleSetContent,
    setProjectId: handleSetProjectId,
    setCategory: handleSetCategory,
    setCategories: handleSetCategories,
  }
}
