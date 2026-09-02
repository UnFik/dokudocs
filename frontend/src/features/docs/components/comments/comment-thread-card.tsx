import { useState } from 'react'
import {
  CheckCircle2,
  CornerDownRight,
  Edit2,
  MoreHorizontal,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import {
  type CommentAuthor,
  type CommentThread,
  useCommentStore,
} from '@/stores/comment-store'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'

interface CommentThreadCardProps {
  thread: CommentThread
  isActive?: boolean
  onSelectSnippet?: (text: string) => void
}

function formatGoogleDocsTime(dateStr: string) {
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear()

    const timeStr = date.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    })

    if (isToday) {
      return `${timeStr} Today`
    }

    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    const isYesterday =
      date.getDate() === yesterday.getDate() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getFullYear() === yesterday.getFullYear()

    if (isYesterday) {
      return `${timeStr} Yesterday`
    }

    return date.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return 'Recently'
  }
}

export function CommentThreadCard({
  thread,
  isActive = false,
  onSelectSnippet,
}: CommentThreadCardProps) {
  const { auth } = useAuthStore()
  const {
    addReply,
    editComment,
    deleteThread,
    deleteReply,
    toggleResolveThread,
    setActiveThreadId,
  } = useCommentStore()

  const [isReplying, setIsReplying] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [editingReplyId, setEditingReplyId] = useState<string | null | 'root'>(
    null
  )
  const [editContentText, setEditContentText] = useState('')

  const currentUser: CommentAuthor = {
    id: auth.user?.accountNo || 'usr-1',
    name: auth.user?.email ? auth.user.email.split('@')[0] : 'Fikri',
    email: auth.user?.email || 'fikri@dokudocs.app',
    avatar: '/avatars/01.png',
  }

  const handleStartEdit = (replyId: string | null, initialText: string) => {
    setEditingReplyId(replyId ?? 'root')
    setEditContentText(initialText)
  }

  const handleSaveEdit = (replyId: string | null) => {
    if (!editContentText.trim()) return
    editComment(thread.id, replyId, editContentText.trim())
    setEditingReplyId(null)
    setEditContentText('')
  }

  const handleAddReply = () => {
    if (!replyText.trim()) return
    addReply(thread.id, replyText.trim(), currentUser)
    setReplyText('')
    setIsReplying(false)
  }

  return (
    <div
      onClick={() => setActiveThreadId(thread.id)}
      className={`group rounded-xl border p-3.5 text-xs transition-all ${
        isActive
          ? 'border-primary/50 bg-primary/5 shadow-sm ring-1 ring-primary/30'
          : thread.isResolved
            ? 'border-border/40 bg-muted/20 opacity-80'
            : 'border-border/70 bg-card hover:border-border hover:shadow-xs'
      }`}
    >
      {thread.sectionTitle && (
        <div className='mb-2.5 px-0.5 text-[11px] font-semibold tracking-tight text-muted-foreground/80'>
          {thread.sectionTitle}
        </div>
      )}

      <div className='flex items-start justify-between gap-2'>
        <div className='flex min-w-0 items-center gap-2.5'>
          <Avatar className='size-7 shrink-0'>
            <AvatarImage src={thread.author.avatar} alt={thread.author.name} />
            <AvatarFallback className='text-[10px] font-semibold uppercase'>
              {thread.author.name.slice(0, 2)}
            </AvatarFallback>
          </Avatar>
          <div className='min-w-0 leading-tight'>
            <span className='block truncate text-xs font-semibold text-foreground'>
              {thread.author.name}
            </span>
            <span className='text-[10px] text-muted-foreground/80'>
              {formatGoogleDocsTime(thread.createdAt)}
            </span>
          </div>
        </div>

        <div className='flex shrink-0 items-center gap-1'>
          <Button
            variant='ghost'
            size='icon'
            onClick={(e) => {
              e.stopPropagation()
              toggleResolveThread(thread.id, currentUser)
            }}
            className={`size-6 rounded-full transition-colors ${
              thread.isResolved
                ? 'text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-600'
                : 'text-muted-foreground/50 hover:bg-emerald-500/10 hover:text-emerald-500'
            }`}
            title={thread.isResolved ? 'Re-open thread' : 'Resolve thread'}
          >
            {thread.isResolved ? (
              <RotateCcw className='size-3.5' />
            ) : (
              <CheckCircle2 className='size-3.5' />
            )}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button
                variant='ghost'
                size='icon'
                className='size-6 rounded-full text-muted-foreground hover:text-foreground'
              >
                <MoreHorizontal className='size-3.5' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-32'>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  handleStartEdit(null, thread.content)
                }}
                className='gap-2 text-xs'
              >
                <Edit2 className='size-3.5' />
                <span>Edit</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  deleteThread(thread.id)
                }}
                className='gap-2 text-xs text-destructive focus:text-destructive'
              >
                <Trash2 className='size-3.5' />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {thread.selectedText && (
        <button
          type='button'
          onClick={(e) => {
            e.stopPropagation()
            onSelectSnippet?.(thread.selectedText)
          }}
          className='mt-2 line-clamp-2 block w-full cursor-pointer rounded-md border border-border/40 bg-muted/40 px-2.5 py-1.5 text-left text-[11px] text-muted-foreground italic transition-colors hover:bg-muted/70'
          title='Click to jump to text'
        >
          “{thread.selectedText}”
        </button>
      )}

      {editingReplyId === 'root' ? (
        <div className='mt-2 space-y-1.5' onClick={(e) => e.stopPropagation()}>
          <Textarea
            value={editContentText}
            onChange={(e) => setEditContentText(e.target.value)}
            className='min-h-[50px] resize-none text-xs'
            autoFocus
          />
          <div className='flex items-center justify-end gap-1.5'>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setEditingReplyId(null)}
              className='h-6 px-2 text-[11px]'
            >
              Cancel
            </Button>
            <Button
              size='sm'
              onClick={() => handleSaveEdit(null)}
              className='h-6 px-2.5 text-[11px]'
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p className='mt-2 text-xs leading-relaxed whitespace-pre-wrap text-foreground/90'>
          {thread.content}
        </p>
      )}

      {thread.replies && thread.replies.length > 0 && (
        <div className='mt-3 space-y-2.5 border-t border-border/40 pt-2.5'>
          {thread.replies.map((reply) => (
            <div
              key={reply.id}
              className='group/reply flex items-start gap-2 rounded-md p-1 hover:bg-muted/30'
            >
              <Avatar className='mt-0.5 size-5 shrink-0'>
                <AvatarImage
                  src={reply.author.avatar}
                  alt={reply.author.name}
                />
                <AvatarFallback className='text-[8px] font-semibold uppercase'>
                  {reply.author.name.slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <div className='min-w-0 flex-1'>
                <div className='flex items-center justify-between gap-1'>
                  <div className='flex items-center gap-1.5'>
                    <span className='text-[11px] font-medium text-foreground'>
                      {reply.author.name}
                    </span>
                    <span className='text-[9px] text-muted-foreground/60'>
                      {formatGoogleDocsTime(reply.createdAt)}
                    </span>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      asChild
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant='ghost'
                        size='icon'
                        className='size-5 opacity-0 transition-opacity group-hover/reply:opacity-100'
                      >
                        <MoreHorizontal className='size-3 text-muted-foreground' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end' className='w-28'>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation()
                          handleStartEdit(reply.id, reply.content)
                        }}
                        className='gap-1.5 text-xs'
                      >
                        <Edit2 className='size-3' />
                        <span>Edit</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteReply(thread.id, reply.id)
                        }}
                        className='gap-1.5 text-xs text-destructive focus:text-destructive'
                      >
                        <Trash2 className='size-3' />
                        <span>Delete</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {editingReplyId === reply.id ? (
                  <div
                    className='mt-1 space-y-1.5'
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Textarea
                      value={editContentText}
                      onChange={(e) => setEditContentText(e.target.value)}
                      className='min-h-[44px] resize-none text-xs'
                      autoFocus
                    />
                    <div className='flex items-center justify-end gap-1.5'>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => setEditingReplyId(null)}
                        className='h-6 px-2 text-[11px]'
                      >
                        Cancel
                      </Button>
                      <Button
                        size='sm'
                        onClick={() => handleSaveEdit(reply.id)}
                        className='h-6 px-2.5 text-[11px]'
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className='mt-0.5 text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/90'>
                    {reply.content}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className='mt-2.5 flex items-center justify-between pt-1'>
        {!isReplying ? (
          <Button
            variant='ghost'
            size='sm'
            onClick={(e) => {
              e.stopPropagation()
              setIsReplying(true)
            }}
            className='h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground'
          >
            <CornerDownRight className='size-3' />
            <span>Reply</span>
          </Button>
        ) : (
          <div
            className='w-full space-y-2'
            onClick={(e) => e.stopPropagation()}
          >
            <Textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder='Write a reply... (⌘+Enter to submit)'
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleAddReply()
                }
                if (e.key === 'Escape') {
                  setIsReplying(false)
                }
              }}
              className='min-h-[50px] resize-none bg-background text-xs'
              autoFocus
            />
            <div className='flex items-center justify-end gap-1.5'>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setIsReplying(false)}
                className='h-6 px-2 text-[11px]'
              >
                Cancel
              </Button>
              <Button
                size='sm'
                onClick={handleAddReply}
                disabled={!replyText.trim()}
                className='h-6 px-2.5 text-[11px]'
              >
                Reply
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
