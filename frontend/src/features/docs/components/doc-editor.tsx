import { useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearch } from '@tanstack/react-router'
import type { DocumentItem } from '@/types/dokudocs'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { useCommentStore } from '@/stores/comment-store'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { getDocument } from '@/lib/domain-api'
import { getLocalUserScope, subscribeLocalUser } from '@/lib/user-storage'
import { useTheme } from '@/context/theme-provider'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { Button } from '@/components/ui/button'
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces'
import { useDocEditor } from '../hooks/use-doc-editor'
import { DbmlEditor } from './dbml-editor'
import { MermaidExportDialog } from './dialogs/mermaid-export-dialog'
import { EditorHeader } from './editor-header'
import { MarkdownEditor } from './markdown-editor'
import { MermaidEditor } from './mermaid-editor'
import { RemoteMarkdownDocEditor } from './remote-markdown-doc-editor'
import { VersionHistorySidebar } from './version-history-sidebar'

export function DocEditor() {
  const { docId } = useParams({ from: '/docs/$docId' })
  const { workspaceId: citationWorkspaceID, nodeId: citationNodeID } =
    useSearch({ from: '/docs/$docId' })
  const scope = useSyncExternalStore(subscribeLocalUser, getLocalUserScope)
  const auth = useAuthStore((state) => state.auth)
  const { activeWorkspaceId, isLoading: workspacesLoading } = useWorkspaces()
  const workspaceID = citationWorkspaceID ?? activeWorkspaceId
  const cachedDocument = useDokudocsStore((state) =>
    state.documents.find((item) => item.id === docId)
  )
  const offline =
    auth.status === 'offline' ||
    (typeof navigator !== 'undefined' && !navigator.onLine)
  const cachedMarkdown =
    cachedDocument?.type === 'markdown' ? cachedDocument : undefined
  const isRemoteID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      docId
    )
  const documentQuery = useQuery({
    queryKey: ['document', workspaceID, docId, scope.userId],
    queryFn: async ({ signal }) => {
      const document = await getDocument(workspaceID, docId, signal)
      if (document.type === 'markdown')
        useDokudocsStore.getState().upsertDocument({
          ...document,
          content: '',
        })
      return document
    },
    enabled:
      isRemoteID && Boolean(workspaceID) && auth.status === 'authenticated',
    retry: false,
  })

  if (!isRemoteID)
    return (
      <ScopedDocEditor key={`${scope.generation}:${docId}`} docId={docId} />
    )

  if (offline) {
    if (!cachedMarkdown?.workspaceId)
      return (
        <DocumentLoadError message='This document is not available offline' />
      )
    return (
      <RemoteMarkdownDocEditor
        key={`${scope.generation}:${docId}:${citationNodeID ?? ''}`}
        document={{ ...cachedMarkdown, content: '' }}
        workspaceID={cachedMarkdown.workspaceId}
        userID={scope.userId ?? ''}
        offline
      />
    )
  }

  if (workspacesLoading)
    return (
      <div className='p-6 text-sm text-muted-foreground'>Loading document…</div>
    )
  if (!workspaceID)
    return (
      <DocumentLoadError message='No workspace is available for this document' />
    )
  if (documentQuery.isPending)
    return (
      <div className='p-6 text-sm text-muted-foreground'>Loading document…</div>
    )
  if (documentQuery.error || !documentQuery.data)
    return (
      <DocumentLoadError
        message={documentQuery.error?.message ?? 'Document not found'}
      />
    )

  if (documentQuery.data.type === 'markdown')
    return (
      <RemoteMarkdownDocEditor
        key={`${scope.generation}:${docId}:${citationNodeID ?? ''}`}
        document={documentQuery.data}
        workspaceID={workspaceID}
        userID={scope.userId ?? auth.user?.id ?? ''}
        focusNodeID={citationNodeID}
      />
    )

  return (
    <HydrateLegacyDocument
      key={`${scope.generation}:${docId}`}
      document={documentQuery.data}
      docId={docId}
      generation={scope.generation}
    />
  )
}

function HydrateLegacyDocument({
  document,
  docId,
  generation,
}: {
  document: DocumentItem
  docId: string
  generation: number
}) {
  const [hydrated, setHydrated] = useState(false)
  useMountEffect(() => {
    useDokudocsStore.getState().upsertDocument(document)
    setHydrated(true)
  })
  return hydrated ? (
    <ScopedDocEditor key={`${generation}:${docId}`} docId={docId} />
  ) : (
    <div className='p-6 text-sm text-muted-foreground'>Loading document…</div>
  )
}

function DocumentLoadError({ message }: { message: string }) {
  return (
    <div className='flex h-[70vh] flex-col items-center justify-center text-center'>
      <h2 className='text-lg font-bold'>Could not open document</h2>
      <p role='alert' className='mt-1 text-sm text-muted-foreground'>
        {message}
      </p>
      <Button asChild size='sm' className='mt-4 text-xs'>
        <Link to='/'>Back to Dashboard</Link>
      </Button>
    </div>
  )
}

function ScopedDocEditor({ docId }: { docId: string }) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const {
    document: doc,
    title,
    content,
    projectId,
    category,
    categories,
    isSaving,
    isDirty,
    lastSaved,
    setTitle,
    setContent,
  } = useDocEditor(docId)

  const [isMermaidExportOpen, setIsMermaidExportOpen] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)

  const toggleStarDocument = useDokudocsStore(
    (state) => state.toggleStarDocument
  )
  const isSidebarOpen = useCommentStore((state) => state.isSidebarOpen)
  const toggleSidebar = useCommentStore((state) => state.toggleSidebar)
  const unresolvedCount = useCommentStore((state) =>
    doc ? state.getDocUnresolvedCount(doc.id) : 0
  )

  const handleToggleStar = () => {
    if (!doc) return
    toggleStarDocument(doc.id)
    toast.success(doc.isStarred ? 'Document unstarred' : 'Document starred')
  }

  if (!doc) {
    return (
      <div className='flex h-[70vh] flex-col items-center justify-center text-center'>
        <h2 className='text-lg font-bold'>Document Not Found</h2>
        <p className='mt-1 text-xs text-muted-foreground'>
          The requested document does not exist or was moved to Trash.
        </p>
        <Button asChild size='sm' className='mt-4 text-xs'>
          <Link to='/'>Back to Dashboard</Link>
        </Button>
      </div>
    )
  }

  const handleExportCode = () => {
    navigator.clipboard.writeText(content)
    toast.success('Document raw code copied to clipboard')
  }

  const getDiagramSvg = (): string | null => {
    const svgEl = document.querySelector(
      '#mermaid-canvas-layer svg, [data-preview-layer] svg, svg.pointer-events-none, .dokudocs-preview-svg svg'
    )
    if (svgEl) {
      return new XMLSerializer().serializeToString(svgEl)
    }
    return null
  }

  const handleExportCopySvg = () => {
    const svgText = getDiagramSvg()
    if (!svgText) {
      toast.error('No rendered diagram found to copy SVG')
      return
    }
    navigator.clipboard.writeText(svgText)
    toast.success('SVG code copied to clipboard')
  }

  const handleExportSvg = () => {
    const svgText = getDiagramSvg()
    if (!svgText) {
      toast.error('No rendered diagram found to export SVG')
      return
    }
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'diagram'}.svg`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('SVG diagram downloaded')
  }

  const handleExportPng = () => {
    const svgText = getDiagramSvg()
    if (!svgText) {
      toast.error('No rendered diagram found to export PNG')
      return
    }
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const img = new Image()
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)

    img.onload = () => {
      const scale = 2
      canvas.width = (img.width || 800) * scale
      canvas.height = (img.height || 600) * scale
      if (ctx) {
        ctx.fillStyle = isDark ? '#09090b' : '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const pngUrl = canvas.toDataURL('image/png')
        const a = document.createElement('a')
        a.href = pngUrl
        a.download = `${title.toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'diagram'}.png`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
      URL.revokeObjectURL(url)
      toast.success('PNG image downloaded')
    }
    img.src = url
  }

  const isDiagram = doc.type === 'mermaid' || doc.type === 'dbdiagram'

  return (
    <div className='flex h-screen w-full flex-col overflow-hidden bg-background'>
      <EditorHeader
        docId={doc.id}
        title={title}
        type={doc.type}
        projectId={projectId}
        category={category}
        categories={categories}
        isSaving={isSaving}
        isDirty={isDirty}
        lastSaved={lastSaved}
        onTitleChange={setTitle}
        onExportDiagram={
          doc.type === 'mermaid'
            ? () => setIsMermaidExportOpen(true)
            : undefined
        }
        onExportCode={handleExportCode}
        onExportCopySvg={isDiagram ? handleExportCopySvg : undefined}
        onExportSvg={isDiagram ? handleExportSvg : undefined}
        onExportPng={isDiagram ? handleExportPng : undefined}
        onToggleComments={doc.type === 'markdown' ? toggleSidebar : undefined}
        isCommentsOpen={isSidebarOpen}
        commentsCount={doc.type === 'markdown' ? unresolvedCount : undefined}
        onToggleHistory={() => setIsHistoryOpen(!isHistoryOpen)}
        isHistoryOpen={isHistoryOpen}
        isStarred={doc.isStarred}
        onToggleStar={handleToggleStar}
      />

      <div className='flex-1 overflow-hidden'>
        {doc.type === 'markdown' && (
          <MarkdownEditor
            docId={doc.id}
            content={content}
            onChange={setContent}
          />
        )}
        {doc.type === 'dbdiagram' && (
          <DbmlEditor docId={doc.id} content={content} onChange={setContent} />
        )}
        {doc.type === 'mermaid' && (
          <MermaidEditor
            docId={doc.id}
            content={content}
            onChange={setContent}
          />
        )}
      </div>

      <VersionHistorySidebar
        docId={doc.id}
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        onRestoreContent={setContent}
      />

      {doc.type === 'mermaid' && (
        <MermaidExportDialog
          open={isMermaidExportOpen}
          onOpenChange={setIsMermaidExportOpen}
          docTitle={title}
          content={content}
          svg={getDiagramSvg() || ''}
        />
      )}
    </div>
  )
}
