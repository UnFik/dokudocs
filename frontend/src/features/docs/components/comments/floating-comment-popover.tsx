import { useRef, useState } from 'react'
import { Check, MessageSquare, X } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { type CommentAuthor, useCommentStore } from '@/stores/comment-store'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface FloatingCommentPopoverProps {
  isOpen: boolean
  onClose: () => void
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
  docId: string
  onWrapSelection?: (threadId: string, text: string) => void
}

export function FloatingCommentPopover({
  isOpen,
  onClose,
  anchorRect,
  selectedText,
  blockId,
  blockPath,
  from,
  to,
  docId,
  onWrapSelection,
}: FloatingCommentPopoverProps) {
  const { auth } = useAuthStore()
  const { addThread } = useCommentStore()
  const [commentContent, setCommentContent] = useState('')
  const popoverRef = useRef<HTMLDivElement | null>(null)

  if (!isOpen || !anchorRect) {
    return null
  }

  const currentUser: CommentAuthor = {
    id: auth.user?.accountNo || 'usr-1',
    name: auth.user?.email ? auth.user.email.split('@')[0] : 'Fikri',
    email: auth.user?.email || 'fikri@dokudocs.app',
    avatar: '/avatars/01.png',
  }

  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200
  const viewportHeight =
    typeof window !== 'undefined' ? window.innerHeight : 800

  const popoverWidth = 320
  const popoverHeight = 180

  let top = anchorRect.bottom + 8
  if (top + popoverHeight > viewportHeight - 16) {
    top = Math.max(16, anchorRect.top - popoverHeight - 8)
  }

  let left = anchorRect.left
  if (left + popoverWidth > viewportWidth - 16) {
    left = Math.max(16, viewportWidth - popoverWidth - 16)
  }

  const handleSubmit = () => {
    if (!commentContent.trim()) return

    const newThread = addThread({
      docId,
      selectedText,
      blockId,
      blockPath,
      from,
      to,
      content: commentContent.trim(),
      author: currentUser,
    })

    if (newThread && selectedText && onWrapSelection) {
      onWrapSelection(newThread.id, selectedText)
    }

    setCommentContent('')
    onClose()
  }

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        width: `${popoverWidth}px`,
        zIndex: 60,
      }}
      className='animate-in rounded-xl border border-border/80 bg-popover/95 p-3.5 text-popover-foreground shadow-xl backdrop-blur-md duration-150 zoom-in-95 fade-in'
    >
      <div className='flex items-center justify-between gap-2 border-b border-border/50 pb-2'>
        <div className='flex items-center gap-1.5 text-xs font-semibold text-foreground'>
          <MessageSquare className='size-3.5 text-primary' />
          <span>Add Comment</span>
        </div>

        <Button
          variant='ghost'
          size='icon'
          onClick={onClose}
          className='size-6 text-muted-foreground hover:text-foreground'
        >
          <X className='size-3.5' />
        </Button>
      </div>

      <div className='mt-2.5 space-y-2.5'>
        {selectedText && (
          <div className='line-clamp-2 rounded-md border border-border/50 bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground italic'>
            “{selectedText}”
          </div>
        )}

        <div className='space-y-1'>
          <Textarea
            value={commentContent}
            onChange={(e) => setCommentContent(e.target.value)}
            placeholder='Write a comment... (⌘+Enter to submit)'
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleSubmit()
              }
              if (e.key === 'Escape') {
                onClose()
              }
            }}
            className='min-h-[70px] resize-none bg-background/60 text-xs'
            autoFocus
          />
        </div>

        <div className='flex items-center justify-between pt-1'>
          <span className='text-[10px] text-muted-foreground/60'>
            {currentUser.name}
          </span>
          <div className='flex items-center gap-1.5'>
            <Button
              variant='ghost'
              size='sm'
              onClick={onClose}
              className='h-7 px-2.5 text-xs'
            >
              Cancel
            </Button>
            <Button
              size='sm'
              onClick={handleSubmit}
              disabled={!commentContent.trim()}
              className='h-7 gap-1 px-3 text-xs font-medium'
            >
              <Check className='size-3.5' />
              <span>Comment</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

