import { useState } from 'react'
import {
  Check,
  CheckCircle2,
  CornerDownRight,
  Edit2,
  MoreHorizontal,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import { useCommentStore } from '@/stores/comment-store'
import type {
  CommentAuthor,
  CommentThread,
} from '@/stores/comment-store'
import { useAuthStore } from '@/stores/auth-store'
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
  onApplySuggestion?: (transformContent: (content: string) => string) => void
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
  onApplySuggestion,
}: CommentThreadCardProps) {
  const { auth } = useAuthStore()
  const {
    addReply,
    editComment,
    deleteThread,
    deleteReply,
    toggleResolveThread,
    acceptSuggestion,
    rejectSuggestion,
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

  const handleAcceptSuggestion = () => {
    if (!onApplySuggestion) return
    acceptSuggestion(thread.id, onApplySuggestion)
  }

  const handleRejectSuggestion = () => {
    if (!onApplySuggestion) return
    rejectSuggestion(thread.id, onApplySuggestion)
  }

  return (
    <div
      onClick={() => setActiveThreadId(thread.id)}
      className={`group rounded-xl border p-3.5 transition-all text-xs ${
        isActive
          ? 'border-primary/50 bg-primary/5 shadow-sm ring-1 ring-primary/30'
          : thread.isResolved
          ? 'border-border/40 bg-muted/20 opacity-80'
          : 'border-border/70 bg-card hover:border-border hover:shadow-xs'
      }`}
    >
      {thread.sectionTitle && (
        <div className='text-[11px] font-semibold text-muted-foreground/80 mb-2.5 px-0.5 tracking-tight'>
          {thread.sectionTitle}
        </div>
      )}

      <div className='flex items-start justify-between gap-2'>
        <div className='flex items-center gap-2.5 min-w-0'>
          <Avatar className='size-7 shrink-0'>
            <AvatarImage src={thread.author.avatar} alt={thread.author.name} />
            <AvatarFallback className='text-[10px] uppercase font-semibold'>
              {thread.author.name.slice(0, 2)}
            </AvatarFallback>
          </Avatar>
          <div className='min-w-0 leading-tight'>
            <span className='font-semibold text-foreground truncate block text-xs'>
              {thread.author.name}
            </span>
            <span className='text-[10px] text-muted-foreground/80'>
              {formatGoogleDocsTime(thread.createdAt)}
            </span>
          </div>
        </div>

        <div className='flex items-center gap-1 shrink-0'>
          {thread.suggestion &&
            thread.suggestion.status === 'pending' &&
            onApplySuggestion && (
              <>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={(e) => {
                    e.stopPropagation()
                    handleAcceptSuggestion()
                  }}
                  className='size-6 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/15 rounded-full'
                  title='Accept suggestion'
                >
                  <Check className='size-3.5' />
                </Button>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRejectSuggestion()
                  }}
                  className='size-6 text-muted-foreground hover:text-destructive hover:bg-destructive/15 rounded-full'
                  title='Reject suggestion'
                >
                  <X className='size-3.5' />
                </Button>
              </>
            )}

          {!thread.suggestion && (
            <Button
              variant='ghost'
              size='icon'
              onClick={(e) => {
                e.stopPropagation()
                toggleResolveThread(thread.id, currentUser, onApplySuggestion)
              }}
              className={`size-6 rounded-full transition-colors ${
                thread.isResolved
                  ? 'text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10'
                  : 'text-muted-foreground/50 hover:text-emerald-500 hover:bg-emerald-500/10'
              }`}
              title={thread.isResolved ? 'Re-open thread' : 'Resolve thread'}
            >
              {thread.isResolved ? (
                <RotateCcw className='size-3.5' />
              ) : (
                <CheckCircle2 className='size-3.5' />
              )}
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button
                variant='ghost'
                size='icon'
                className='size-6 text-muted-foreground hover:text-foreground rounded-full'
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
                className='text-xs gap-2'
              >
                <Edit2 className='size-3.5' />
                <span>Edit</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  deleteThread(thread.id, onApplySuggestion)
                }}
                className='text-xs gap-2 text-destructive focus:text-destructive'
              >
                <Trash2 className='size-3.5' />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!thread.suggestion && thread.selectedText && (
        <button
          type='button'
          onClick={(e) => {
            e.stopPropagation()
            onSelectSnippet?.(thread.selectedText)
          }}
          className='mt-2 block w-full text-left rounded-md bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground line-clamp-2 italic hover:bg-muted/70 transition-colors cursor-pointer border border-border/40'
          title='Click to jump to text'
        >
          “{thread.selectedText}”
        </button>
      )}

      {thread.suggestion && (
        <div className='mt-2.5 leading-relaxed text-xs text-foreground/90'>
          {thread.suggestion.type === 'replace' && (
            <p>
              <strong className='font-semibold text-foreground'>Replace:</strong>{' '}
              <em className='italic text-foreground/80'>
                “{thread.suggestion.originalText}”
              </em>{' '}
              with{' '}
              <em className='italic text-foreground/80'>
                “{thread.suggestion.suggestedText}”
              </em>
            </p>
          )}
          {thread.suggestion.type === 'add' && (
            <p>
              <strong className='font-semibold text-foreground'>Add:</strong>{' '}
              <em className='italic text-foreground/80'>
                “{thread.suggestion.suggestedText}”
              </em>
            </p>
          )}
          {thread.suggestion.type === 'delete' && (
            <p>
              <strong className='font-semibold text-foreground'>Delete:</strong>{' '}
              <em className='italic text-foreground/80'>
                “{thread.suggestion.originalText}”
              </em>
            </p>
          )}
        </div>
      )}

      {editingReplyId === 'root' ? (
        <div className='mt-2 space-y-1.5' onClick={(e) => e.stopPropagation()}>
          <Textarea
            value={editContentText}
            onChange={(e) => setEditContentText(e.target.value)}
            className='min-h-[50px] text-xs resize-none'
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
        !thread.suggestion && (
          <p className='mt-2 text-foreground/90 whitespace-pre-wrap text-xs leading-relaxed'>
            {thread.content}
          </p>
        )
      )}

      {thread.replies && thread.replies.length > 0 && (
        <div className='mt-3 space-y-2.5 border-t border-border/40 pt-2.5'>
          {thread.replies.map((reply) => (
            <div
              key={reply.id}
              className='flex items-start gap-2 group/reply rounded-md p-1 hover:bg-muted/30'
            >
              <Avatar className='size-5 shrink-0 mt-0.5'>
                <AvatarImage src={reply.author.avatar} alt={reply.author.name} />
                <AvatarFallback className='text-[8px] uppercase font-semibold'>
                  {reply.author.name.slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <div className='flex-1 min-w-0'>
                <div className='flex items-center justify-between gap-1'>
                  <div className='flex items-center gap-1.5'>
                    <span className='font-medium text-foreground text-[11px]'>
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
                        className='size-5 opacity-0 group-hover/reply:opacity-100 transition-opacity'
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
                        className='text-xs gap-1.5'
                      >
                        <Edit2 className='size-3' />
                        <span>Edit</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteReply(thread.id, reply.id)
                        }}
                        className='text-xs gap-1.5 text-destructive focus:text-destructive'
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
                      className='min-h-[44px] text-xs resize-none'
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
                  <p className='text-foreground/90 whitespace-pre-wrap text-[11px] leading-relaxed mt-0.5'>
                    {reply.content}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className='mt-2.5 pt-1 flex items-center justify-between'>
        {!isReplying ? (
          <Button
            variant='ghost'
            size='sm'
            onClick={(e) => {
              e.stopPropagation()
              setIsReplying(true)
            }}
            className='h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground gap-1'
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
              className='min-h-[50px] text-xs resize-none bg-background'
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
