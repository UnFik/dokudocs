import { useMemo, useRef } from 'react'
import { AlignLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDbml } from '../lib/format-dbml'
import type { SourceBinding } from '../lib/source-binding'
import { DbmlVisualCanvas } from './previews/dbml-visual-canvas'
import { UnifiedMonacoEditor, type SourceCollab } from './unified-monaco-editor'

interface DbmlEditorProps {
  docId?: string
  content: string
  onChange: (newContent: string) => void
  /** Edited together: the editor writes the shared source, and `content` is its preview. */
  collab?: SourceCollab
}

export function DbmlEditor({
  docId,
  content,
  onChange,
  collab,
}: DbmlEditorProps) {
  const bindingRef = useRef<SourceBinding | null>(null)
  const shared = useMemo<SourceCollab | undefined>(
    () =>
      collab && {
        ...collab,
        onBinding: (binding) => {
          bindingRef.current = binding
          collab.onBinding?.(binding)
        },
      },
    [collab]
  )

  const formatCode = () => {
    // Formatted from the source as it is now, so a result is never stale.
    if (shared) bindingRef.current?.replace(formatDbml(shared.text.toString()))
    else onChange(formatDbml(content))
  }

  const customActions = (
    <Button
      variant='ghost'
      size='sm'
      onClick={formatCode}
      disabled={collab?.readOnly}
      className='h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground'
      title='Beautify schema code'
    >
      <AlignLeft className='size-3 text-muted-foreground' />
      <span>Format</span>
    </Button>
  )

  return (
    <UnifiedMonacoEditor
      docId={docId}
      collab={shared}
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
