import { useRef, useState } from 'react'
import { Edit3, Eye, ListTree, Redo2, Undo2 } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { useCommentStore } from '@/stores/comment-store'
import { useEditorPreferenceStore } from '@/stores/editor-preference-store'
import { Button } from '@/components/ui/button'
import { CommentsSidebar } from './comments/comments-sidebar'
import { FloatingCommentPopover } from './comments/floating-comment-popover'
import {
  type CommentTriggerPayload,
  MuyaEditor,
  type MuyaEditorHandle,
} from './muya-editor/MuyaEditor'
import { UnifiedMonacoEditor } from './unified-monaco-editor'

interface MarkdownEditorProps {
  docId: string
  content: string
  onChange: (newContent: string) => void
}

interface PopoverState {
  isOpen: boolean
  anchorRect: {
    top: number
    bottom: number
    left: number
    right: number
    width: number
    height: number
  } | null
  selectedText: string
  blockId?: string
  blockPath?: (string | number)[]
  from?: number
  to?: number
}

const DEFAULT_POPOVER_STATE: PopoverState = {
  isOpen: false,
  anchorRect: null,
  selectedText: '',
}

export function MarkdownEditor({
  docId,
  content,
  onChange,
}: MarkdownEditorProps) {
  const { auth } = useAuthStore()
  const userId = auth.user?.accountNo || auth.user?.email || 'guest'
  const muyaEditorRef = useRef<MuyaEditorHandle | null>(null)
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
  })

  const { isSidebarOpen, setSidebarOpen } = useCommentStore()

  const [popoverState, setPopoverState] = useState<PopoverState>(
    DEFAULT_POPOVER_STATE
  )

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
  const previewMode = userPreference?.previewMode ?? 'edit'

  const handleContentChange = (newContent: string) => {
    onChange(newContent)
  }

  const handleCommentTrigger = (payload: CommentTriggerPayload) => {
    setPopoverState({
      isOpen: true,
      anchorRect: payload.rect,
      selectedText: payload.selectedText,
      blockId: payload.blockId,
      blockPath: payload.blockPath,
      from: payload.from,
      to: payload.to,
    })
  }

  const previewLeftActions = (
    <div className='flex items-center gap-1'>
      <Button
        variant={showToc ? 'secondary' : 'ghost'}
        size='sm'
        onClick={() => setShowOutline(userId, !showToc)}
        className={`h-6 gap-1 px-2 text-[11px] ${
          showToc
            ? 'bg-blue-500/15 font-medium text-blue-600 dark:text-blue-400'
            : 'text-muted-foreground hover:text-foreground'
        }`}
        title='Toggle Outline / Table of Contents'
      >
        <ListTree className='size-3' />
        <span>Outline</span>
      </Button>

      {previewMode === 'edit' && (
        <>
          <div className='mx-0.5 h-4 w-px bg-border/60' />
          <Button
            variant='ghost'
            size='icon'
            onClick={() => muyaEditorRef.current?.undo()}
            disabled={!historyState.canUndo}
            className='size-6 cursor-pointer text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-30'
            title='Undo (⌘Z / Ctrl+Z)'
          >
            <Undo2 className='size-3.5' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => muyaEditorRef.current?.redo()}
            disabled={!historyState.canRedo}
            className='size-6 cursor-pointer text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-30'
            title='Redo (⌘Y / Ctrl+Y)'
          >
            <Redo2 className='size-3.5' />
          </Button>
        </>
      )}
    </div>
  )

  const handleSwitchToView = () => {
    setPreviewMode(userId, 'view')
  }

  const handleSwitchToEdit = () => {
    setPreviewMode(userId, 'edit')
    setViewMode(userId, 'preview')
  }

  const previewRightActions = (
    <div className='flex items-center rounded-md border border-border/80 bg-muted/60 p-0.5'>
      <button
        type='button'
        data-testid='preview-mode-view'
        onClick={handleSwitchToView}
        className={`flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-all ${
          previewMode === 'view'
            ? 'bg-background font-semibold text-foreground shadow-xs'
            : 'text-muted-foreground hover:text-foreground'
        }`}
        title='Read-only rendered document'
      >
        <Eye className='size-3 text-blue-500' />
        <span>View</span>
      </button>

      <button
        type='button'
        data-testid='preview-mode-edit'
        onClick={handleSwitchToEdit}
        className={`flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-all ${
          previewMode === 'edit'
            ? 'bg-background font-semibold text-foreground shadow-xs'
            : 'text-muted-foreground hover:text-foreground'
        }`}
        title='In-place interactive rich editor'
      >
        <Edit3 className='size-3 text-emerald-500' />
        <span>Edit</span>
      </button>
    </div>
  )

  return (
    <div className='relative flex h-full w-full overflow-hidden'>
      <div className='h-full min-w-0 flex-1 overflow-hidden'>
        <UnifiedMonacoEditor
          content={content}
          onChange={handleContentChange}
          language='markdown'
          previewContent={({ navigateToSource }) => (
            <MuyaEditor
              key={`${docId}-${previewMode}`}
              docId={docId}
              content={content}
              onChange={handleContentChange}
              onHistoryChange={setHistoryState}
              readOnly={previewMode === 'view'}
              className='h-full w-full'
              editorRef={muyaEditorRef}
              showToc={showToc}
              onNavigateToSource={navigateToSource}
              onCommentTrigger={handleCommentTrigger}
            />
          )}
          showLiveRenderToggle={false}
          showSyncScrollToggle={true}
          previewLeftActions={previewLeftActions}
          previewToolbarActions={previewRightActions}
        />
      </div>

      <FloatingCommentPopover
        isOpen={popoverState.isOpen}
        onClose={() => setPopoverState(DEFAULT_POPOVER_STATE)}
        anchorRect={popoverState.anchorRect}
        selectedText={popoverState.selectedText}
        blockId={popoverState.blockId}
        blockPath={popoverState.blockPath}
        from={popoverState.from}
        to={popoverState.to}
        docId={docId}
      />

      <CommentsSidebar
        docId={docId}
        isOpen={isSidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelectSnippet={(text) => muyaEditorRef.current?.scrollToText(text)}
      />
    </div>
  )
}
