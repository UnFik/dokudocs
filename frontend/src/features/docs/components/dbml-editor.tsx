import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DbmlVisualCanvas } from './previews/dbml-visual-canvas'
import { UnifiedMonacoEditor } from './unified-monaco-editor'

interface DbmlEditorProps {
  docId?: string
  content: string
  onChange: (newContent: string) => void
}

export function DbmlEditor({ docId, content, onChange }: DbmlEditorProps) {
  const formatCode = () => {
    const formatted = content
      .split('\n')
      .map((line) => {
        const trimmed = line.trim()
        if (
          trimmed.startsWith('Table ') ||
          trimmed.startsWith('Enum ') ||
          trimmed.startsWith('TableGroup ') ||
          trimmed.startsWith('Project ')
        ) {
          return trimmed
        }
        if (trimmed === '}') {
          return '}'
        }
        if (trimmed && !trimmed.startsWith('//')) {
          return '  ' + trimmed
        }
        return trimmed
      })
      .join('\n')

    onChange(formatted)
  }

  const customActions = (
    <Button
      variant='ghost'
      size='sm'
      onClick={formatCode}
      className='h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground'
      title='Beautify schema code'
    >
      <Sparkles className='size-3 text-emerald-500' />
      <span>Format</span>
    </Button>
  )

  return (
    <UnifiedMonacoEditor
      docId={docId}
      content={content}
      onChange={onChange}
      language='dbml'
      previewContent={({ navigateToSource }) => (
        <DbmlVisualCanvas
          docId={docId}
          content={content}
          onNavigateToSource={navigateToSource}
        />
      )}
      customToolbarActions={customActions}
    />
  )
}
