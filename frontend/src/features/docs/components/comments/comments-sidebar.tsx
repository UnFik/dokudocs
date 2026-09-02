import { useState, useMemo } from 'react'
import { CheckCircle2, MessageSquare, Plus, Send, X } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { type CommentAuthor, useCommentStore } from '@/stores/comment-store'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { CommentThreadCard } from './comment-thread-card'

interface CommentsSidebarProps {
  docId: string
  isOpen: boolean
  onClose: () => void
  onSelectSnippet?: (text: string) => void
}

export function CommentsSidebar({
  docId,
  isOpen,
  onClose,
  onSelectSnippet,
}: CommentsSidebarProps) {
  const { auth } = useAuthStore()
  const { threads, activeThreadId, addThread } = useCommentStore()

  const [activeTab, setActiveTab] = useState<'open' | 'resolved'>('open')
  const [isAddingDocComment, setIsAddingDocComment] = useState(false)
  const [docCommentText, setDocCommentText] = useState('')

  const docThreads = useMemo(() => {
    return (threads || []).filter((t) => t.docId === docId)
  }, [threads, docId])

  const openThreads = useMemo(() => {
    return docThreads.filter((t) => !t.isResolved)
  }, [docThreads])

  const resolvedThreads = useMemo(() => {
    return docThreads.filter((t) => t.isResolved)
  }, [docThreads])

  const displayedThreads = activeTab === 'open' ? openThreads : resolvedThreads

  const currentUser: CommentAuthor = {
    id: auth.user?.accountNo || 'usr-1',
    name: auth.user?.email ? auth.user.email.split('@')[0] : 'Fikri',
    email: auth.user?.email || 'fikri@dokudocs.app',
    avatar: '/avatars/01.png',
  }

  const handleCreateDocComment = () => {
    if (!docCommentText.trim()) return
    addThread({
      docId,
      selectedText: '',
      content: docCommentText.trim(),
      author: currentUser,
    })
    setDocCommentText('')
    setIsAddingDocComment(false)
    setActiveTab('open')
  }

  if (!isOpen) return null

  return (
    <aside className='z-30 flex h-full w-80 shrink-0 animate-in flex-col border-l border-border/80 bg-background/95 shadow-lg backdrop-blur-md duration-200 slide-in-from-right-4 2xl:w-96'>
      <div className='flex items-center justify-between border-b border-border/60 px-4 py-3'>
        <div className='flex items-center gap-2'>
          <MessageSquare className='size-4 text-primary' />
          <h2 className='text-sm font-semibold tracking-tight text-foreground'>
            Comments
          </h2>
          {openThreads.length > 0 && (
            <span className='rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary'>
              {openThreads.length}
            </span>
          )}
        </div>

        <div className='flex items-center gap-1'>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => setIsAddingDocComment(!isAddingDocComment)}
            className='size-7 text-muted-foreground hover:text-foreground'
            title='Add document comment'
          >
            <Plus className='size-4' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            onClick={onClose}
            className='size-7 text-muted-foreground hover:text-foreground'
            title='Close sidebar'
          >
            <X className='size-4' />
          </Button>
        </div>
      </div>

      <div className='flex items-center justify-between border-b border-border/40 bg-muted/20 px-4 py-2'>
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as 'open' | 'resolved')}
          className='w-full'
        >
          <TabsList className='grid h-7 w-full grid-cols-2 bg-muted/60 p-0.5'>
            <TabsTrigger
              value='open'
              className='h-6 gap-1 text-[11px] font-medium'
            >
              <span>Open</span>
              {openThreads.length > 0 && (
                <span className='text-[10px] text-muted-foreground'>
                  ({openThreads.length})
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value='resolved'
              className='h-6 gap-1 text-[11px] font-medium'
            >
              <span>Resolved</span>
              {resolvedThreads.length > 0 && (
                <span className='text-[10px] text-muted-foreground'>
                  ({resolvedThreads.length})
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isAddingDocComment && (
        <div className='animate-in space-y-2 border-b border-border/50 bg-card/60 p-3 duration-150 fade-in'>
          <div className='flex items-center justify-between'>
            <span className='text-[11px] font-medium text-foreground'>
              New Document Comment
            </span>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => setIsAddingDocComment(false)}
              className='size-5 text-muted-foreground hover:text-foreground'
            >
              <X className='size-3' />
            </Button>
          </div>
          <Textarea
            value={docCommentText}
            onChange={(e) => setDocCommentText(e.target.value)}
            placeholder='Add a comment about the whole document... (⌘+Enter)'
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleCreateDocComment()
              }
              if (e.key === 'Escape') {
                setIsAddingDocComment(false)
              }
            }}
            className='min-h-[64px] resize-none bg-background text-xs'
            autoFocus
          />
          <div className='flex items-center justify-end gap-1.5'>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setIsAddingDocComment(false)}
              className='h-6 px-2 text-[11px]'
            >
              Cancel
            </Button>
            <Button
              size='sm'
              onClick={handleCreateDocComment}
              disabled={!docCommentText.trim()}
              className='h-6 gap-1 px-2.5 text-[11px]'
            >
              <Send className='size-3' />
              <span>Comment</span>
            </Button>
          </div>
        </div>
      )}

      <ScrollArea className='flex-1 p-3'>
        {displayedThreads.length > 0 ? (
          <div className='space-y-3 pb-8'>
            {displayedThreads.map((thread) => (
              <CommentThreadCard
                key={thread.id}
                thread={thread}
                isActive={activeThreadId === thread.id}
                onSelectSnippet={onSelectSnippet}
              />
            ))}
          </div>
        ) : (
          <div className='flex h-64 flex-col items-center justify-center px-4 text-center'>
            <div className='mb-2.5 flex size-10 items-center justify-center rounded-full bg-muted/60 text-muted-foreground'>
              {activeTab === 'open' ? (
                <MessageSquare className='size-5' />
              ) : (
                <CheckCircle2 className='size-5' />
              )}
            </div>
            <p className='text-xs font-semibold text-foreground'>
              {activeTab === 'open'
                ? 'No open comments'
                : 'No resolved comments'}
            </p>
            <p className='mt-1 max-w-[200px] text-[11px] leading-relaxed text-muted-foreground'>
              {activeTab === 'open'
                ? 'Select text in the editor to leave a comment.'
                : 'Resolved comments will appear here.'}
            </p>
          </div>
        )}
      </ScrollArea>
    </aside>
  )
}
