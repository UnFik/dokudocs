import { useRef } from 'react'
import { Edit3, Eye, ListTree, Redo2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { useEditorPreferenceStore } from '@/stores/editor-preference-store'
import { MuyaEditor, MuyaEditorHandle } from './muya-editor/MuyaEditor'
import { UnifiedMonacoEditor } from './unified-monaco-editor'

interface MarkdownEditorProps {
  content: string
  onChange: (newContent: string) => void
}

export function MarkdownEditor({ content, onChange }: MarkdownEditorProps) {
  const { auth } = useAuthStore()
  const userId = auth.user?.accountNo || auth.user?.email || 'guest'
  const muyaEditorRef = useRef<MuyaEditorHandle | null>(null)

  const userPreference = useEditorPreferenceStore(
    (state) => state.preferencesByUser[userId]
  )
  const setShowOutline = useEditorPreferenceStore(
    (state) => state.setShowOutline
  )
  const setPreviewMode = useEditorPreferenceStore(
    (state) => state.setPreviewMode
  )
  const setViewMode = useEditorPreferenceStore((state) => state.setViewMode)

  const showToc = userPreference?.showOutline ?? false
  const previewMode = userPreference?.previewMode ?? 'view'

  const previewLeftActions = (
    <div className='flex items-center gap-1'>
      <Button
        variant={showToc ? 'secondary' : 'ghost'}
        size='sm'
        onClick={() => setShowOutline(userId, !showToc)}
        className={`h-6 gap-1 px-2 text-[11px] ${
          showToc
            ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 font-medium'
            : 'text-muted-foreground hover:text-foreground'
        }`}
        title='Toggle Outline / Table of Contents'
      >
        <ListTree className='size-3' />
        <span>Outline</span>
      </Button>

      {previewMode === 'edit' && (
        <>
          <div className='h-4 w-px bg-border/60 mx-0.5' />
          <Button
            variant='ghost'
            size='icon'
            onClick={() => muyaEditorRef.current?.undo()}
            className='size-6 text-muted-foreground hover:text-foreground cursor-pointer'
            title='Undo (⌘Z / Ctrl+Z)'
          >
            <Undo2 className='size-3.5' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => muyaEditorRef.current?.redo()}
            className='size-6 text-muted-foreground hover:text-foreground cursor-pointer'
            title='Redo (⌘Y / Ctrl+Y)'
          >
            <Redo2 className='size-3.5' />
          </Button>
        </>
      )}
    </div>
  )

  const previewRightActions = (
    <div className='flex items-center rounded-md bg-muted/60 p-0.5 border border-border/80'>
      <button
        type='button'
        onClick={() => setPreviewMode(userId, 'view')}
        className={`flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded transition-all cursor-pointer ${
          previewMode === 'view'
            ? 'bg-background text-foreground shadow-xs font-semibold'
            : 'text-muted-foreground hover:text-foreground'
        }`}
        title='Read-only rendered preview'
      >
        <Eye className='size-3 text-blue-500' />
        <span>View</span>
      </button>
      <button
        type='button'
        onClick={() => {
          setPreviewMode(userId, 'edit')
          setViewMode(userId, 'preview')
        }}
        className={`flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded transition-all cursor-pointer ${
          previewMode === 'edit'
            ? 'bg-background text-foreground shadow-xs font-semibold'
            : 'text-muted-foreground hover:text-foreground'
        }`}
        title='In-place interactive rich editor (Full preview)'
      >
        <Edit3 className='size-3 text-purple-500' />
        <span>Edit</span>
      </button>
    </div>
  )

  return (
    <UnifiedMonacoEditor
      content={content}
      onChange={onChange}
      language='markdown'
      previewContent={({ navigateToSource }) => (
        <MuyaEditor
          content={content}
          onChange={onChange}
          readOnly={previewMode === 'view'}
          className='h-full w-full'
          editorRef={muyaEditorRef}
          showToc={showToc}
          onNavigateToSource={navigateToSource}
        />
      )}
      showLiveRenderToggle={false}
      showSyncScrollToggle={true}
      previewLeftActions={previewLeftActions}
      previewToolbarActions={previewRightActions}
    />
  )
}
