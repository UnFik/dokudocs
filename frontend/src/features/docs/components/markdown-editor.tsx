import { ListTree } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { useEditorPreferenceStore } from '@/stores/editor-preference-store'
import { MarkdownPreview } from './previews/markdown-preview'
import { UnifiedMonacoEditor } from './unified-monaco-editor'

interface MarkdownEditorProps {
  content: string
  onChange: (newContent: string) => void
}

export function MarkdownEditor({ content, onChange }: MarkdownEditorProps) {
  const { auth } = useAuthStore()
  const userId = auth.user?.accountNo || auth.user?.email || 'guest'

  const userPreference = useEditorPreferenceStore(
    (state) => state.preferencesByUser[userId]
  )
  const setShowOutline = useEditorPreferenceStore(
    (state) => state.setShowOutline
  )
  const showToc = userPreference?.showOutline ?? false

  const previewActions = (
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
  )

  return (
    <UnifiedMonacoEditor
      content={content}
      onChange={onChange}
      language='markdown'
      previewContent={({ scrollRef, onScroll, navigateToSource }) => (
        <MarkdownPreview
          content={content}
          scrollRef={scrollRef}
          onScroll={onScroll}
          showToc={showToc}
          onNavigateToSource={navigateToSource}
        />
      )}
      showLiveRenderToggle={false}
      showSyncScrollToggle={true}
      previewToolbarActions={previewActions}
    />
  )
}

