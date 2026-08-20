import { Link, useParams } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useDocEditor } from '../hooks/use-doc-editor'
import { DbmlEditor } from './dbml-editor'
import { EditorHeader } from './editor-header'
import { MarkdownEditor } from './markdown-editor'
import { MermaidEditor } from './mermaid-editor'
import { Button } from '@/components/ui/button'

export function DocEditor() {
  const { docId } = useParams({ from: '/docs/$docId' })
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

  const handleExportSvg = () => {
    toast.success('Exporting SVG image...')
  }

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
        onExportCode={handleExportCode}
        onExportSvg={handleExportSvg}
      />

      <div className='flex-1 overflow-hidden'>
        {doc.type === 'markdown' && (
          <MarkdownEditor content={content} onChange={setContent} />
        )}
        {doc.type === 'dbdiagram' && (
          <DbmlEditor docId={doc.id} content={content} onChange={setContent} />
        )}
        {doc.type === 'mermaid' && (
          <MermaidEditor content={content} onChange={setContent} />
        )}
      </div>
    </div>
  )
}
