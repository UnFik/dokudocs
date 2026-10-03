import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  createDocumentComment,
  maxCommentLength,
  replyToDocumentComment,
  setDocumentCommentResolved,
  type CommentAnchor,
  type CommentThread,
} from '@/lib/domain-api'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join('') || '?'
  )
}

function Quote({ text }: { text: string }) {
  if (!text) return null
  return (
    <blockquote className='mt-1 line-clamp-3 rounded-sm bg-muted px-2 py-1 text-xs break-words text-muted-foreground'>
      {text}
    </blockquote>
  )
}

function CommentForm({
  id,
  label,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
  autoFocus,
}: {
  id: string
  label: string
  submitLabel: string
  pending: boolean
  onSubmit: (content: string) => void
  onCancel?: () => void
  autoFocus?: boolean
}) {
  const [draft, setDraft] = useState('')
  const trimmed = draft.trim()
  const tooLong = draft.length > maxCommentLength
  const send = () => {
    if (trimmed && !tooLong && !pending) onSubmit(trimmed)
  }
  return (
    <form
      className='mt-2 space-y-1'
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
    >
      <label className='block text-muted-foreground' htmlFor={id}>
        {label}
      </label>
      <Textarea
        id={id}
        className='min-h-14 text-xs md:text-xs'
        value={draft}
        autoFocus={autoFocus}
        aria-invalid={tooLong}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            send()
          }
          if (event.key === 'Escape' && onCancel) {
            event.preventDefault()
            onCancel()
          }
        }}
      />
      {tooLong ? (
        <p role='alert' className='text-destructive'>
          Comments can be up to {maxCommentLength} characters. Cut{' '}
          {draft.length - maxCommentLength} to send it.
        </p>
      ) : null}
      <div className='flex gap-1'>
        <Button
          size='sm'
          type='submit'
          variant='outline'
          disabled={!trimmed || tooLong || pending}
        >
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button size='sm' type='button' variant='ghost' onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  )
}

/** The card for a comment being written: the quoted text and an input. */
export function NewCommentCard({
  workspaceID,
  documentID,
  selectedText,
  anchor,
  onDone,
}: {
  workspaceID: string
  documentID: string
  selectedText: string
  anchor: CommentAnchor
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (content: string) =>
      createDocumentComment(workspaceID, documentID, {
        threadID: crypto.randomUUID(),
        selectedText,
        content,
        anchor,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['document-comments', workspaceID, documentID],
      })
      onDone()
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <li
      data-new-comment
      className='border-t py-2 text-xs first:border-t-0'
      aria-label='New comment'
    >
      <Quote text={selectedText} />
      <CommentForm
        id='new-comment'
        label='Comment'
        submitLabel='Comment'
        pending={mutation.isPending}
        autoFocus
        onSubmit={(content) => mutation.mutate(content)}
        onCancel={onDone}
      />
    </li>
  )
}

/** One comment thread in the review rail. */
export function CommentCard({
  thread,
  userID,
  canInteract,
  orphaned,
  focused,
  workspaceID,
  documentID,
  onSelect,
}: {
  thread: CommentThread
  userID: string
  canInteract: boolean
  /** The words the thread was about are gone or were copied elsewhere. */
  orphaned: boolean
  focused: boolean
  workspaceID: string
  documentID: string
  onSelect: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const resolved = Boolean(thread.resolvedAt)
  const [showReplies, setShowReplies] = useState(false)
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ['document-comments', workspaceID, documentID],
    })
  const reply = useMutation({
    mutationFn: (content: string) =>
      replyToDocumentComment(workspaceID, documentID, thread.id, {
        replyID: crypto.randomUUID(),
        content,
      }),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  })
  const resolve = useMutation({
    mutationFn: (next: boolean) =>
      setDocumentCommentResolved(workspaceID, documentID, thread.id, next),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  })
  const repliesShown = !resolved || showReplies
  const who = (id: string, name: string) =>
    id === userID ? 'You' : name || 'Collaborator'

  return (
    <li
      data-comment-thread-id={thread.id}
      data-focused={focused ? 'true' : undefined}
      className={`border-t py-2 text-xs first:border-t-0 ${focused ? 'bg-secondary outline outline-1 -outline-offset-1 outline-border' : ''}`}
    >
      <div className='flex min-w-0 flex-wrap items-center gap-2 text-muted-foreground'>
        <Avatar aria-hidden className='size-6 shrink-0 border'>
          <AvatarFallback className='bg-muted text-[9px] text-muted-foreground'>
            {initials(thread.authorName)}
          </AvatarFallback>
        </Avatar>
        <span className='min-w-0 break-words'>
          {who(thread.authorId, thread.authorName)}
        </span>
        <time className='text-[10px] tabular-nums' dateTime={thread.createdAt}>
          {new Date(thread.createdAt).toLocaleString()}
        </time>
        {orphaned ? (
          <span className='rounded-sm bg-border px-1 font-mono text-[10.5px] text-foreground'>
            text changed
          </span>
        ) : null}
        {resolved ? <span>Resolved</span> : null}
      </div>
      <Quote text={thread.selectedText} />
      <Button
        type='button'
        variant='ghost'
        size='sm'
        className='h-auto min-h-11 w-full justify-start px-0 py-2 text-left text-xs font-normal whitespace-normal text-foreground'
        aria-label={`Show in document: ${thread.selectedText || thread.content}`}
        disabled={orphaned}
        onClick={() => onSelect(thread.id)}
      >
        <span className='break-words whitespace-pre-wrap'>
          {thread.content}
        </span>
      </Button>
      {resolved && thread.replies.length ? (
        <Button
          size='sm'
          variant='ghost'
          aria-expanded={showReplies}
          onClick={() => setShowReplies((open) => !open)}
        >
          {showReplies
            ? 'Hide replies'
            : `Show ${thread.replies.length} ${thread.replies.length === 1 ? 'reply' : 'replies'}`}
        </Button>
      ) : null}
      {repliesShown && thread.replies.length ? (
        <ul className='mt-1 space-y-2' aria-label='Replies'>
          {thread.replies.map((item) => (
            <li key={item.id}>
              <p className='flex items-baseline gap-2'>
                <span className='font-medium'>
                  {who(item.authorId, item.authorName)}
                </span>
                <time
                  dateTime={item.createdAt}
                  className='font-mono text-[11px] text-muted-foreground tabular-nums'
                >
                  {new Date(item.createdAt).toLocaleString()}
                </time>
              </p>
              <p className='break-words whitespace-pre-wrap'>{item.content}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {canInteract && !resolved ? (
        <CommentForm
          id={`comment-reply-${thread.id}`}
          label='Reply'
          submitLabel='Send reply'
          pending={reply.isPending}
          onSubmit={(content) => reply.mutate(content)}
        />
      ) : null}
      {canInteract ? (
        <div className='mt-2'>
          <Button
            size='sm'
            variant='ghost'
            disabled={resolve.isPending}
            onClick={() => resolve.mutate(!resolved)}
          >
            {resolved ? 'Reopen comment' : 'Resolve comment'}
          </Button>
        </div>
      ) : null}
    </li>
  )
}
