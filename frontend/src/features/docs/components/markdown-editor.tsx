import { useRef, useState } from 'react'
import {
  Edit3,
  Eye,
  ListTree,
  MessageSquare,
  Redo2,
  Undo2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { useEditorPreferenceStore } from '@/stores/editor-preference-store'
import { type CommentAuthor, useCommentStore } from '@/stores/comment-store'
import { useMountEffect } from '@/hooks/use-mount-effect'
import {
  type CommentTriggerPayload,
  MuyaEditor,
  type MuyaEditorHandle,
} from './muya-editor/MuyaEditor'
import { UnifiedMonacoEditor } from './unified-monaco-editor'
import { FloatingCommentPopover } from './comments/floating-comment-popover'
import { CommentsSidebar } from './comments/comments-sidebar'

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
  blockPath?: (string | number)[]
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

  const { isSidebarOpen, setSidebarOpen, syncDocumentSuggestions } =
    useCommentStore()

  const [popoverState, setPopoverState] = useState<PopoverState>(
    DEFAULT_POPOVER_STATE
  )

  const currentUser: CommentAuthor = {
    id: auth.user?.accountNo || 'usr-1',
    name: auth.user?.email ? auth.user.email.split('@')[0] : 'Fikri',
    email: auth.user?.email || 'fikri@dokudocs.app',
    avatar: '/avatars/01.png',
  }

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

  useMountEffect(() => {
    syncDocumentSuggestions(docId, content, currentUser)
  })

  const handleContentChange = (newContent: string) => {
    onChange(newContent)
    syncDocumentSuggestions(docId, newContent, currentUser)
  }

  const handleCommentTrigger = (payload: CommentTriggerPayload) => {
    setPopoverState({
      isOpen: true,
      anchorRect: payload.rect,
      selectedText: payload.selectedText,
      blockPath: payload.blockPath,
    })
  }

  const handleApplySuggestion = (
    transformContent: (currentContent: string) => string
  ) => {
    const updated = transformContent(content)
    onChange(updated)
    syncDocumentSuggestions(docId, updated, currentUser)
  }

  const handleWrapSelection = (threadId: string, textToWrap: string) => {
    if (!textToWrap) return
    const wrapped = `<mark class="doc-comment-highlight" data-thread-id="${threadId}">${textToWrap}</mark>`
    if (content.includes(textToWrap)) {
      const updated = content.replace(textToWrap, wrapped)
      onChange(updated)
    }
  }

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

      {(previewMode === 'edit' || previewMode === 'suggesting') && (
        <>
          <div className='h-4 w-px bg-border/60 mx-0.5' />
          <Button
            variant='ghost'
            size='icon'
            onClick={() => muyaEditorRef.current?.undo()}
            disabled={!historyState.canUndo}
            className='size-6 text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-30 disabled:pointer-events-none'
            title='Undo (⌘Z / Ctrl+Z)'
          >
            <Undo2 className='size-3.5' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => muyaEditorRef.current?.redo()}
            disabled={!historyState.canRedo}
            className='size-6 text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-30 disabled:pointer-events-none'
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
        title='Read-only rendered document'
      >
        <Eye className='size-3 text-blue-500' />
        <span>View</span>
      </button>

      <button
        type='button'
        onClick={() => {
          setPreviewMode(userId, 'suggesting')
          setViewMode(userId, 'preview')
        }}
        className={`flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded transition-all cursor-pointer ${
          previewMode === 'suggesting'
            ? 'bg-background text-foreground shadow-xs font-semibold'
            : 'text-muted-foreground hover:text-foreground'
        }`}
        title='Suggest edits & comments'
      >
        <MessageSquare className='size-3 text-primary' />
        <span>Suggesting</span>
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
        title='In-place interactive rich editor'
      >
        <Edit3 className='size-3 text-emerald-500' />
        <span>Edit</span>
      </button>
    </div>
  )

  return (
    <div className='relative flex h-full w-full overflow-hidden'>
      <div className='flex-1 min-w-0 h-full overflow-hidden'>
        <UnifiedMonacoEditor
          content={content}
          onChange={handleContentChange}
          language='markdown'
          previewContent={({ navigateToSource }) => (
            <MuyaEditor
              key={`${docId}-${previewMode}`}
              content={content}
              onChange={handleContentChange}
              onHistoryChange={setHistoryState}
              readOnly={previewMode === 'view'}
              isSuggestingMode={previewMode === 'suggesting'}
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
        blockPath={popoverState.blockPath}
        docId={docId}
        onWrapSelection={handleWrapSelection}
      />

      <CommentsSidebar
        docId={docId}
        isOpen={isSidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelectSnippet={(text) => muyaEditorRef.current?.scrollToText(text)}
        onApplySuggestion={handleApplySuggestion}
      />
    </div>
  )
}
