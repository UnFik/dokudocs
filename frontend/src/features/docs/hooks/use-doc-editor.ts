import { useCallback, useRef, useState } from 'react'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { getDocCategories } from '@/lib/doc-category-utils'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { generateDualThumbnailsAsync } from '../lib/doc-thumbnail-generator'

interface EditorState {
  title: string
  content: string
  projectId: string | null
  categories: string[]
}

export function useDocEditor(docId: string) {
  const updateDocument = useDokudocsStore((s) => s.updateDocument)
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
  }

  useMountEffect(() => {
    if (docId) {
      recordDocumentView(docId)
    }

    if (doc && !doc.thumbnail) {
      generateDualThumbnailsAsync(doc.type, doc.content, doc.id).then(
        (thumb) => {
          if (thumb.thumbnail || thumb.thumbnailDark) {
            updateDocumentThumbnail(
              doc.id,
              thumb.thumbnail,
              thumb.thumbnailDark
            )
          }
        }
      )
    }

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
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
        }
      }
    }
  })

  const performSave = useCallback(
    async (stateToSave: EditorState) => {
      if (!doc) return
      setIsSaving(true)
      const targetProject = projects.find((p) => p.id === stateToSave.projectId)
      const currentTitle = stateToSave.title.trim() || 'Untitled Document'

      const thumb = await generateDualThumbnailsAsync(
        doc.type,
        stateToSave.content,
        doc.id
      )

      updateDocument(doc.id, {
        title: currentTitle,
        content: stateToSave.content,
        projectId: stateToSave.projectId ?? null,
        projectName: targetProject?.name ?? null,
        categories: stateToSave.categories,
        category: stateToSave.categories[0] ?? null,
        isDraft: !stateToSave.projectId,
        thumbnail: thumb.thumbnail || doc.thumbnail,
        thumbnailDark: thumb.thumbnailDark || doc.thumbnailDark,
      })
      setIsSaving(false)
      setIsDirty(false)
      isDirtyRef.current = false
      setLastSaved(new Date())
    },
    [doc, projects, updateDocument]
  )

  const triggerAutoSave = useCallback(
    (nextState: EditorState) => {
      latestStateRef.current = nextState
      isDirtyRef.current = true
      setIsDirty(true)

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }

      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null
        void performSave(nextState)
      }, 1000)
    },
    [performSave]
  )

  const handleSetContent = useCallback(
    (newContent: string) => {
      setContent(newContent)
      updateDocument(docId, { content: newContent })
      triggerAutoSave({
        title,
        content: newContent,
        projectId,
        categories,
      })
    },
    [docId, updateDocument, title, projectId, categories, triggerAutoSave]
  )

  const handleSetTitle = useCallback(
    (newTitle: string) => {
      setTitle(newTitle)
      updateDocument(docId, { title: newTitle.trim() || 'Untitled Document' })
      triggerAutoSave({
        title: newTitle,
        content,
        projectId,
        categories,
      })
    },
    [docId, updateDocument, content, projectId, categories, triggerAutoSave]
  )

  const handleSetProjectId = useCallback(
    (newProjectId: string | null) => {
      setProjectId(newProjectId)
      const targetProject = projects.find((p) => p.id === newProjectId)
      updateDocument(docId, {
        projectId: newProjectId,
        projectName: targetProject?.name ?? null,
        isDraft: !newProjectId,
      })
      triggerAutoSave({
        title,
        content,
        projectId: newProjectId,
        categories,
      })
    },
    [docId, projects, updateDocument, title, content, categories, triggerAutoSave]
  )

  const handleSetCategories = useCallback(
    (newCategories: string[]) => {
      setCategories(newCategories)
      updateDocument(docId, {
        categories: newCategories,
        category: newCategories[0] ?? null,
      })
      triggerAutoSave({
        title,
        content,
        projectId,
        categories: newCategories,
      })
    },
    [docId, updateDocument, title, content, projectId, triggerAutoSave]
  )

  const handleSetCategory = useCallback(
    (newCategory: string | null) => {
      const nextCategories = newCategory ? [newCategory] : []
      setCategories(nextCategories)
      updateDocument(docId, {
        categories: nextCategories,
        category: newCategory,
      })
      triggerAutoSave({
        title,
        content,
        projectId,
        categories: nextCategories,
      })
    },
    [docId, updateDocument, title, content, projectId, triggerAutoSave]
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
