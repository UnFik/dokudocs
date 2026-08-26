import { useCallback, useEffect, useRef, useState } from 'react'
import { getDocCategories } from '@/lib/doc-category-utils'
import { generateDualThumbnailsAsync } from '../lib/doc-thumbnail-generator'
import { useDokudocsStore } from '@/stores/dokudocs-store'

export function useDocEditor(docId: string) {
  const updateDocument = useDokudocsStore((s) => s.updateDocument)
  const updateDocumentThumbnail = useDokudocsStore((s) => s.updateDocumentThumbnail)
  const recordDocumentView = useDokudocsStore((s) => s.recordDocumentView)
  const projects = useDokudocsStore((s) => s.projects)
  const doc = useDokudocsStore(
    useCallback((s) => s.documents.find((d) => d.id === docId), [docId])
  )

  const [title, setTitle] = useState(doc?.title ?? '')
  const [content, setContent] = useState(doc?.content ?? '')
  const [projectId, setProjectId] = useState<string | null>(doc?.projectId ?? null)
  const [categories, setCategories] = useState<string[]>(() => getDocCategories(doc))
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)

  const docIdRef = useRef(doc?.id)
  const initialLoadedRef = useRef(false)
  const contentRef = useRef(content)
  const titleRef = useRef(title)
  const projectIdRef = useRef(projectId)
  const categoriesRef = useRef(categories)

  useEffect(() => {
    contentRef.current = content
  }, [content])

  useEffect(() => {
    titleRef.current = title
  }, [title])

  useEffect(() => {
    projectIdRef.current = projectId
  }, [projectId])

  useEffect(() => {
    categoriesRef.current = categories
  }, [categories])

  useEffect(() => {
    if (docId) {
      recordDocumentView(docId)
    }
  }, [docId, recordDocumentView])

  useEffect(() => {
    if (doc && (!initialLoadedRef.current || doc.id !== docIdRef.current)) {
      docIdRef.current = doc.id
      initialLoadedRef.current = true
      setTitle(doc.title)
      setContent(doc.content)
      setProjectId(doc.projectId ?? null)
      setCategories(getDocCategories(doc))
      setIsDirty(false)

      if (!doc.thumbnail) {
        generateDualThumbnailsAsync(doc.type, doc.content, doc.id).then((thumb) => {
          if (thumb.thumbnail || thumb.thumbnailDark) {
            updateDocumentThumbnail(doc.id, thumb.thumbnail, thumb.thumbnailDark)
          }
        })
      }
    }
  }, [doc, updateDocumentThumbnail])

  const handleSetContent = useCallback((newContent: string) => {
    setContent(newContent)
    setIsDirty(true)
  }, [])

  const handleSetTitle = useCallback((newTitle: string) => {
    setTitle(newTitle)
    setIsDirty(true)
  }, [])

  const handleSetProjectId = useCallback((newProjectId: string | null) => {
    setProjectId(newProjectId)
    setIsDirty(true)
  }, [])

  const handleSetCategories = useCallback((newCategories: string[]) => {
    setCategories(newCategories)
    setIsDirty(true)
  }, [])

  const handleSetCategory = useCallback((newCategory: string | null) => {
    setCategories(newCategory ? [newCategory] : [])
    setIsDirty(true)
  }, [])

  useEffect(() => {
    if (!isDirty || !doc) return

    setIsSaving(true)
    const timer = setTimeout(async () => {
      const currentProjId = projectIdRef.current
      const targetProject = projects.find((p) => p.id === currentProjId)
      const currentCategories = categoriesRef.current
      const currentTitle = titleRef.current.trim() || 'Untitled Document'
      const currentContent = contentRef.current

      const thumb = await generateDualThumbnailsAsync(
        doc.type,
        currentContent,
        doc.id
      )

      updateDocument(doc.id, {
        title: currentTitle,
        content: currentContent,
        projectId: currentProjId ?? null,
        projectName: targetProject?.name ?? null,
        categories: currentCategories,
        category: currentCategories[0] ?? null,
        isDraft: !currentProjId,
        thumbnail: thumb.thumbnail || doc.thumbnail,
        thumbnailDark: thumb.thumbnailDark || doc.thumbnailDark,
      })
      setIsSaving(false)
      setIsDirty(false)
      setLastSaved(new Date())
    }, 1500)

    return () => clearTimeout(timer)
  }, [isDirty, doc?.id, doc?.type, doc?.thumbnail, doc?.thumbnailDark, updateDocument, projects])

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
