import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  createDocumentComment,
  deleteDocumentComment,
  deleteDocumentCommentReply,
  editDocumentComment,
  editDocumentCommentReply,
  listDocumentComments,
  replyToDocumentComment,
  setDocumentCommentResolved,
  type CommentThread,
} from '@/lib/domain-api'
import { formatRelativeTime } from '@/lib/time-utils'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { CommentText } from '@/components/comment-text'
import { MentionTextarea } from '@/components/mention-textarea'

export const commentsKey = (workspaceID: string, documentID: string) => [
  'document-comments',
  workspaceID,
  documentID,
]

/** The comment threads of a canvas; each points at an element by id. */
export function useCanvasComments(workspaceID: string, documentID: string) {
  return useQuery({
    queryKey: commentsKey(workspaceID, documentID),
    queryFn: ({ signal }) =>
      listDocumentComments(workspaceID, documentID, signal),
    enabled: Boolean(workspaceID && documentID),
    retry: false,
  })
}

/** A comment or a reply, with edit and delete for its author. */
function Entry(props: {
  workspaceID: string
  documentID: string
  label: string
  authorName: string
  content: string
  edited: boolean
  own: boolean
  resolved?: boolean
  saving: boolean
  onSave: (content: string) => void
  onDelete: () => void
  /** What goes with it when it is deleted, said in the confirmation. */
  deleteNote: string
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const fieldID = useId()
  return (
    <div className='flex flex-col gap-1'>
      {editing === null ? (
        <p
          className={cn(
            'whitespace-pre-line',
            props.resolved && 'text-muted-foreground line-through'
          )}
        >
          <CommentText content={props.content} />
          {props.edited && (
            <span className='ml-1 font-mono text-[10.5px] text-muted-foreground'>
              edited
            </span>
          )}
        </p>
      ) : (
        <form
          className='flex flex-col gap-1'
          onSubmit={(event) => {
            event.preventDefault()
            if (editing.trim()) props.onSave(editing.trim())
            setEditing(null)
          }}
        >
          <label htmlFor={fieldID} className='sr-only'>
            Edit {props.label}
          </label>
          <MentionTextarea
            id={fieldID}
            workspaceID={props.workspaceID}
            documentID={props.documentID}
            autoFocus
            value={editing}
            onValueChange={setEditing}
            maxLength={2000}
            className='min-h-12 text-[12.5px]'
          />
          <div className='flex gap-1.5'>
            <Button
              type='submit'
              size='sm'
              variant='outline'
              className='h-7'
              disabled={!editing.trim() || props.saving}
            >
              Save
            </Button>
            <Button
              type='button'
              size='sm'
              variant='ghost'
              className='h-7'
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {props.own && editing === null && !confirming && (
        <div className='flex gap-1.5'>
          <Button
            size='sm'
            variant='ghost'
            className='h-6 px-1.5 text-[11.5px]'
            aria-label={`Edit ${props.label}`}
            onClick={() => setEditing(props.content)}
          >
            Edit
          </Button>
          <Button
            size='sm'
            variant='ghost'
            className='h-6 px-1.5 text-[11.5px] text-destructive'
            aria-label={`Delete ${props.label}`}
            onClick={() => setConfirming(true)}
          >
            Delete
          </Button>
        </div>
      )}
      {confirming && (
        <div
          role='group'
          aria-label={`Delete ${props.label}?`}
          className='flex flex-wrap items-center gap-1.5 text-xs'
        >
          <span>
            Delete this {props.label}
            {props.deleteNote}?
          </span>
          <Button
            size='sm'
            variant='danger'
            className='h-6 px-1.5 text-[11.5px]'
            onClick={() => {
              setConfirming(false)
              props.onDelete()
            }}
          >
            Yes, delete
          </Button>
          <Button
            size='sm'
            variant='ghost'
            className='h-6 px-1.5 text-[11.5px]'
            autoFocus
            onClick={() => setConfirming(false)}
          >
            Keep it
          </Button>
        </div>
      )}
    </div>
  )
}

export function Thread({
  thread,
  workspaceID,
  documentID,
  canComment,
  userID,
  onChanged,
  onOpenOnCanvas,
  as: Tag = 'li',
}: {
  thread: CommentThread
  workspaceID: string
  documentID: string
  canComment: boolean
  /** The person reading: their own comments and replies can be edited or deleted. */
  userID?: string
  onChanged: () => void
  /** Shows the thread's pin on the canvas (from the list in the panel). */
  onOpenOnCanvas?: () => void
  as?: 'li' | 'div'
}) {
  const [reply, setReply] = useState('')
  const queryClient = useQueryClient()
  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: commentsKey(workspaceID, documentID),
    })
    onChanged()
  }
  const send = useMutation({
    mutationFn: () =>
      replyToDocumentComment(workspaceID, documentID, thread.id, {
        replyID: crypto.randomUUID(),
        content: reply.trim(),
      }),
    onSuccess: async () => {
      setReply('')
      await refresh()
    },
    onError: (error) => toast.error(`The reply was not sent: ${error.message}`),
  })
  const resolve = useMutation({
    mutationFn: () =>
      setDocumentCommentResolved(
        workspaceID,
        documentID,
        thread.id,
        !thread.resolvedAt
      ),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  })
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
    onSuccess: refresh,
    onError: (error) =>
      toast.error(`The change was not saved: ${error.message}`),
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
    onSuccess: refresh,
    onError: (error) => toast.error(`It was not deleted: ${error.message}`),
  })
  const own = (authorID: string) =>
    canComment && Boolean(userID) && authorID === userID
  const replyID = `comment-reply-${thread.id}`
  return (
    <Tag className='flex flex-col gap-1.5 border-t border-border py-2 text-[12.5px] first:border-t-0'>
      <div className='flex items-baseline justify-between gap-2'>
        <span className='font-medium'>{thread.authorName || 'Someone'}</span>
        <span className='font-mono text-[10.5px] text-muted-foreground'>
          {formatRelativeTime(thread.createdAt)}
        </span>
      </div>
      <Entry
        workspaceID={workspaceID}
        documentID={documentID}
        label='comment'
        authorName={thread.authorName}
        content={thread.content}
        edited={Boolean(thread.editedAt)}
        own={own(thread.authorId)}
        resolved={Boolean(thread.resolvedAt)}
        saving={edit.isPending}
        onSave={(content) => edit.mutate({ replyID: null, content })}
        onDelete={() => remove.mutate(null)}
        deleteNote={thread.replies.length ? ' and its replies' : ''}
      />
      {thread.replies.map((r) => (
        <div key={r.id} className='border-l border-border pl-2'>
          <span className='font-medium'>{r.authorName || 'Someone'}</span>
          <Entry
            workspaceID={workspaceID}
            documentID={documentID}
            label='reply'
            authorName={r.authorName}
            content={r.content}
            edited={Boolean(r.editedAt)}
            own={own(r.authorId)}
            saving={edit.isPending}
            onSave={(content) => edit.mutate({ replyID: r.id, content })}
            onDelete={() => remove.mutate(r.id)}
            deleteNote=''
          />
        </div>
      ))}
      {canComment && (
        <div className='flex flex-col gap-1'>
          <label htmlFor={replyID} className='sr-only'>
            Reply to {thread.authorName || 'this comment'}
          </label>
          {!thread.resolvedAt && (
            <MentionTextarea
              id={replyID}
              workspaceID={workspaceID}
              documentID={documentID}
              value={reply}
              onValueChange={setReply}
              placeholder='Reply'
              maxLength={2000}
              className='min-h-12 text-[12.5px]'
            />
          )}
          <div className='flex gap-1.5'>
            {!thread.resolvedAt && (
              <Button
                size='sm'
                variant='outline'
                className='h-7'
                disabled={!reply.trim() || send.isPending}
                onClick={() => send.mutate()}
              >
                Reply
              </Button>
            )}
            <Button
              size='sm'
              variant='ghost'
              className='h-7'
              disabled={resolve.isPending}
              onClick={() => resolve.mutate()}
            >
              {thread.resolvedAt ? 'Reopen' : 'Resolve'}
            </Button>
            {onOpenOnCanvas && (
              <Button
                size='sm'
                variant='ghost'
                className='h-7'
                onClick={onOpenOnCanvas}
              >
                Show on canvas
              </Button>
            )}
          </div>
        </div>
      )}
    </Tag>
  )
}

/** The threads on one element of the canvas, and a box to start a new one. */
export function ElementComments({
  workspaceID,
  documentID,
  elementID,
  elementName,
  canComment,
  userID,
  onChanged,
  onOpenThread,
}: {
  workspaceID: string
  documentID: string
  elementID: string
  elementName: string
  canComment: boolean
  userID?: string
  onChanged: () => void
  /** Opens the thread's pin on the canvas. */
  onOpenThread?: (threadID: string) => void
}) {
  const comments = useCanvasComments(workspaceID, documentID)
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const threads = (comments.data ?? []).filter(
    (t) => t.elementAnchor?.elementId === elementID
  )
  const create = useMutation({
    mutationFn: () =>
      createDocumentComment(workspaceID, documentID, {
        threadID: crypto.randomUUID(),
        // The element's name at the time, so the thread still reads if the element goes.
        selectedText: elementName.slice(0, 500),
        content: draft.trim(),
        anchor: { kind: 'element', elementId: elementID },
      }),
    onSuccess: async () => {
      setDraft('')
      await queryClient.invalidateQueries({
        queryKey: commentsKey(workspaceID, documentID),
      })
      onChanged()
    },
    onError: (error) =>
      toast.error(`The comment was not sent: ${error.message}`),
  })
  const newID = `element-comment-${elementID}`
  return (
    <section
      className='flex flex-col gap-1.5'
      aria-labelledby={`${newID}-heading`}
    >
      <h3
        id={`${newID}-heading`}
        className='font-mono text-[11px] text-muted-foreground'
      >
        comments ·{' '}
        <span className='tabular-nums'>
          {threads.filter((t) => !t.resolvedAt).length}
        </span>
      </h3>
      {comments.isPending && (
        <p className='text-xs text-muted-foreground'>Loading comments…</p>
      )}
      {comments.isError && (
        <p className='text-xs'>
          Comments could not be loaded.{' '}
          <button
            type='button'
            className='underline'
            onClick={() => void comments.refetch()}
          >
            Try again
          </button>
        </p>
      )}
      {comments.isSuccess && !threads.length && (
        <p className='text-xs text-muted-foreground'>
          No comments on this element.
        </p>
      )}
      <ul>
        {threads.map((t) => (
          <Thread
            key={t.id}
            thread={t}
            workspaceID={workspaceID}
            documentID={documentID}
            canComment={canComment}
            userID={userID}
            onChanged={onChanged}
            onOpenOnCanvas={
              onOpenThread && !t.resolvedAt
                ? () => onOpenThread(t.id)
                : undefined
            }
          />
        ))}
      </ul>
      {canComment && (
        <form
          className='flex flex-col gap-1'
          onSubmit={(event) => {
            event.preventDefault()
            if (draft.trim()) create.mutate()
          }}
        >
          <label htmlFor={newID} className='sr-only'>
            New comment on {elementName}
          </label>
          <MentionTextarea
            id={newID}
            workspaceID={workspaceID}
            documentID={documentID}
            value={draft}
            onValueChange={setDraft}
            placeholder={`Ask or note something about ${elementName}`}
            maxLength={2000}
            className='min-h-14 text-[12.5px]'
          />
          <Button
            type='submit'
            size='sm'
            variant='outline'
            className='self-start'
            disabled={!draft.trim() || create.isPending}
          >
            Comment
          </Button>
        </form>
      )}
    </section>
  )
}

/** Threads whose element was removed: still readable, listed when nothing is selected. */
export function OrphanedComments({
  workspaceID,
  documentID,
  elementIDs,
}: {
  workspaceID: string
  documentID: string
  elementIDs: Set<string>
}) {
  const comments = useCanvasComments(workspaceID, documentID)
  const orphans = (comments.data ?? []).filter(
    (t) =>
      t.elementAnchor &&
      !elementIDs.has(t.elementAnchor.elementId) &&
      !t.resolvedAt
  )
  if (!orphans.length) return null
  return (
    <section
      className='flex flex-col gap-1.5'
      aria-label='Comments on removed elements'
    >
      <h3 className='font-mono text-[11px] text-muted-foreground'>
        comments on removed elements · {orphans.length}
      </h3>
      <ul>
        {orphans.map((t) => (
          <li
            key={t.id}
            className='border-t border-border py-1.5 text-[12.5px]'
          >
            <p className='text-xs text-muted-foreground'>
              {t.authorName || 'Someone'}, on an element that was removed: “
              {t.selectedText}”
            </p>
            <p>
              <CommentText content={t.content} />
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
