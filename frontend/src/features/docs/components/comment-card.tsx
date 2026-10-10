import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { visibleText } from '@/lib/comment-mentions'
import {
  createDocumentComment,
  deleteDocumentComment,
  deleteDocumentCommentReply,
  editDocumentComment,
  editDocumentCommentReply,
  maxCommentLength,
  replyToDocumentComment,
  setDocumentCommentResolved,
  type CommentAnchor,
  type SourceCommentAnchor,
  type CommentThread,
} from '@/lib/domain-api'
import { Button } from '@/components/ui/button'
import { CommentText } from '@/components/comment-text'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { MentionTextarea } from '@/components/mention-textarea'
import { CardIconButton, ReviewCardHeader, revealOnHover } from './review-card'

/** Compact actions in the review rail: 12px text, 28px high, aligned to the text edge. */
const action = 'h-7 px-2 text-xs'

function Quote({ text }: { text: string }) {
  if (!text) return null
  return (
    <blockquote className='mt-2 line-clamp-3 rounded-sm bg-muted px-2 py-1.5 text-xs break-words text-muted-foreground'>
      {text}
    </blockquote>
  )
}

function CommentForm({
  workspaceID,
  documentID,
  id,
  label,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
  autoFocus,
  initial = '',
}: {
  workspaceID: string
  documentID: string
  id: string
  label: string
  submitLabel: string
  pending: boolean
  onSubmit: (content: string) => void
  onCancel?: () => void
  autoFocus?: boolean
  initial?: string
}) {
  const [draft, setDraft] = useState(initial)
  const trimmed = draft.trim()
  const reads = visibleText(draft).length
  const tooLong = reads > maxCommentLength
  const send = () => {
    if (trimmed && !tooLong && !pending) onSubmit(trimmed)
  }
  return (
    <form
      className='mt-2 space-y-1.5'
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
    >
      <label className='block text-muted-foreground' htmlFor={id}>
        {label}
      </label>
      <MentionTextarea
        id={id}
        workspaceID={workspaceID}
        documentID={documentID}
        className='min-h-14 text-xs md:text-xs'
        value={draft}
        autoFocus={autoFocus}
        aria-invalid={tooLong}
        onValueChange={setDraft}
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
          {reads - maxCommentLength} to send it.
        </p>
      ) : null}
      <div className='flex gap-1.5'>
        <Button
          size='sm'
          className={action}
          type='submit'
          variant='outline'
          disabled={!trimmed || tooLong || pending}
        >
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button
            size='sm'
            className={action}
            type='button'
            variant='ghost'
            onClick={onCancel}
          >
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
  anchor: CommentAnchor | SourceCommentAnchor
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
      className='mb-2 rounded-lg bg-muted/50 p-3 text-xs'
      aria-label='New comment'
    >
      <Quote text={selectedText} />
      <CommentForm
        workspaceID={workspaceID}
        documentID={documentID}
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
  canDecide = false,
  orphaned,
  focused,
  workspaceID,
  documentID,
  onSelect,
}: {
  thread: CommentThread
  userID: string
  canInteract: boolean
  /** An editor may delete anyone's comment; everyone else only their own. */
  canDecide?: boolean
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
  // 'thread' or a reply's id while its text is being edited.
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<{
    replyID: string | null
  } | null>(null)
  const edit = useMutation({
    mutationFn: ({
      replyID,
      content,
    }: {
      replyID: string | null
      content: string
    }) =>
      replyID
        ? editDocumentCommentReply(
            workspaceID,
            documentID,
            thread.id,
            replyID,
            content
          )
        : editDocumentComment(workspaceID, documentID, thread.id, content),
    onSuccess: async () => {
      setEditing(null)
      await refresh()
    },
    onError: (error) => toast.error(error.message),
  })
  const remove = useMutation({
    mutationFn: (replyID: string | null) =>
      replyID
        ? deleteDocumentCommentReply(
            workspaceID,
            documentID,
            thread.id,
            replyID
          )
        : deleteDocumentComment(workspaceID, documentID, thread.id),
    onSuccess: async () => {
      setDeleting(null)
      await refresh()
    },
    onError: (error) => toast.error(error.message),
  })
  const repliesShown = !resolved || showReplies
  const isAuthor = canInteract && thread.authorId === userID
  const canChange = (authorID: string) =>
    canInteract && (authorID === userID || canDecide)
  const who = (id: string, name: string) =>
    id === userID ? 'You' : name || 'Collaborator'

  return (
    <li
      data-comment-thread-id={thread.id}
      data-focused={focused ? 'true' : undefined}
      className={`group mb-2 rounded-lg p-3 text-xs ${focused ? 'bg-secondary ring-1 ring-border' : 'bg-muted/50'}`}
      // A click on the card itself shows the comment in the document and opens the reply box;
      // its buttons and fields keep their own clicks.
      onClick={(event) => {
        if (
          !(event.target as HTMLElement).closest(
            'button,a,input,textarea,label,[role=dialog],[role=alertdialog]'
          )
        )
          onSelect(thread.id)
      }}
    >
      <ReviewCardHeader
        name={who(thread.authorId, thread.authorName)}
        createdAt={thread.createdAt}
        note={[
          thread.editedAt ? 'edited' : '',
          orphaned ? 'text changed' : '',
          resolved ? 'Resolved' : '',
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            {canInteract ? (
              <CardIconButton
                label={resolved ? 'Reopen comment' : 'Resolve comment'}
                kind='accept'
                disabled={resolve.isPending}
                onClick={() => resolve.mutate(!resolved)}
              />
            ) : null}
            {canChange(thread.authorId) ? (
              <CardIconButton
                label='Delete'
                kind='delete'
                onClick={() => setDeleting({ replyID: null })}
              />
            ) : null}
          </>
        }
      />
      {orphaned ? <Quote text={thread.selectedText} /> : null}
      {editing === 'thread' ? (
        <CommentForm
          workspaceID={workspaceID}
          documentID={documentID}
          id={`comment-edit-${thread.id}`}
          label='Edit comment'
          submitLabel='Save'
          initial={thread.content}
          autoFocus
          pending={edit.isPending}
          onSubmit={(content) => edit.mutate({ replyID: null, content })}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <>
          {isAuthor ? (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='-mx-2 mt-1 h-auto min-h-9 w-[calc(100%_+_1rem)] cursor-text justify-start px-2 py-1.5 text-left text-xs font-normal whitespace-normal text-foreground hover:bg-background/70'
              aria-label='Edit this comment'
              title='Click to edit'
              onClick={() => setEditing('thread')}
            >
              <span className='break-words whitespace-pre-wrap'>
                <CommentText content={thread.content} />
              </span>
            </Button>
          ) : orphaned ? (
            // Nothing to show in the document, so this is plain text.
            <p className='mt-1 py-1.5 break-words whitespace-pre-wrap'>
              <CommentText content={thread.content} />
            </p>
          ) : (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='-mx-2 mt-1 h-auto min-h-9 w-[calc(100%_+_1rem)] justify-start px-2 py-1.5 text-left text-xs font-normal whitespace-normal text-foreground'
              aria-label={`Show in document: ${thread.selectedText || visibleText(thread.content)}`}
              onClick={() => onSelect(thread.id)}
            >
              <span className='break-words whitespace-pre-wrap'>
                <CommentText content={thread.content} />
              </span>
            </Button>
          )}
        </>
      )}
      {resolved && thread.replies.length ? (
        <Button
          size='sm'
          className={`${action} -ml-2`}
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
        <ul className='mt-2 space-y-3 border-l pl-3' aria-label='Replies'>
          {thread.replies.map((item) => (
            <li key={item.id}>
              <p className='flex flex-wrap items-baseline gap-x-2'>
                <span className='font-medium'>
                  {who(item.authorId, item.authorName)}
                </span>
                <time
                  dateTime={item.createdAt}
                  className='font-mono text-[11px] text-muted-foreground tabular-nums'
                >
                  {new Date(item.createdAt).toLocaleString()}
                </time>
                {item.editedAt ? (
                  <span className='text-[10px] text-muted-foreground'>
                    edited
                  </span>
                ) : null}
              </p>
              {editing === item.id ? (
                <CommentForm
                  workspaceID={workspaceID}
                  documentID={documentID}
                  id={`comment-edit-${item.id}`}
                  label='Edit reply'
                  submitLabel='Save'
                  initial={item.content}
                  autoFocus
                  pending={edit.isPending}
                  onSubmit={(content) =>
                    edit.mutate({ replyID: item.id, content })
                  }
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <>
                  <p className='break-words whitespace-pre-wrap'>
                    <CommentText content={item.content} />
                  </p>
                  {canChange(item.authorId) ? (
                    <div className={`-ml-2 flex gap-1 ${revealOnHover}`}>
                      {item.authorId === userID ? (
                        <Button
                          size='sm'
                          className={action}
                          variant='ghost'
                          onClick={() => setEditing(item.id)}
                        >
                          Edit reply
                        </Button>
                      ) : null}
                      <Button
                        size='sm'
                        className={action}
                        variant='ghost'
                        onClick={() => setDeleting({ replyID: item.id })}
                      >
                        Delete reply
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {canInteract && !resolved && focused ? (
        <CommentForm
          workspaceID={workspaceID}
          documentID={documentID}
          key={thread.replies.length}
          id={`comment-reply-${thread.id}`}
          label='Reply'
          submitLabel='Send reply'
          pending={reply.isPending}
          onSubmit={(content) => reply.mutate(content)}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={
          deleting?.replyID ? 'Delete this reply?' : 'Delete this comment?'
        }
        desc={
          deleting?.replyID
            ? 'The reply is removed for everyone.'
            : thread.replies.length
              ? `The comment and its ${thread.replies.length} ${thread.replies.length === 1 ? 'reply are' : 'replies are'} removed for everyone.`
              : 'The comment is removed for everyone.'
        }
        confirmText='Delete'
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => remove.mutate(deleting?.replyID ?? null)}
      />
    </li>
  )
}
