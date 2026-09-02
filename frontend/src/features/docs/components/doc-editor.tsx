import { useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useCommentStore } from '@/stores/comment-store'
import { useTheme } from '@/context/theme-provider'
import { Button } from '@/components/ui/button'
import { useDocEditor } from '../hooks/use-doc-editor'
import { DbmlEditor } from './dbml-editor'
import { EditorHeader } from './editor-header'
import { MarkdownEditor } from './markdown-editor'
import { MermaidEditor } from './mermaid-editor'
import { MermaidExportDialog } from './dialogs/mermaid-export-dialog'

export function DocEditor() {
  const { docId } = useParams({ from: '/docs/$docId' })
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

  const isSidebarOpen = useCommentStore((state) => state.isSidebarOpen)
  const toggleSidebar = useCommentStore((state) => state.toggleSidebar)
  const unresolvedCount = useCommentStore((state) =>
    doc ? state.getDocUnresolvedCount(doc.id) : 0
  )

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
        onExportDiagram={doc.type === 'mermaid' ? () => setIsMermaidExportOpen(true) : undefined}
        onExportCode={handleExportCode}
        onExportCopySvg={isDiagram ? handleExportCopySvg : undefined}
        onExportSvg={isDiagram ? handleExportSvg : undefined}
        onExportPng={isDiagram ? handleExportPng : undefined}
        onToggleComments={doc.type === 'markdown' ? toggleSidebar : undefined}
        isCommentsOpen={isSidebarOpen}
        commentsCount={doc.type === 'markdown' ? unresolvedCount : undefined}
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
