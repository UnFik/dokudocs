import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  createDocumentComment,
  listDocumentComments,
  replyToDocumentComment,
  setDocumentCommentResolved,
  type CommentThread,
} from '@/lib/domain-api'
import { formatRelativeTime } from '@/lib/time-utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

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

/** Open threads per element, for the badge on each node. */
export function openThreadCounts(threads: CommentThread[] | undefined) {
  const counts = new Map<string, number>()
  for (const t of threads ?? []) {
    if (t.resolvedAt || !t.elementAnchor) continue
    counts.set(
      t.elementAnchor.elementId,
      (counts.get(t.elementAnchor.elementId) ?? 0) + 1
    )
  }
  return counts
}

function Thread({
  thread,
  workspaceID,
  documentID,
  canComment,
  onChanged,
}: {
  thread: CommentThread
  workspaceID: string
  documentID: string
  canComment: boolean
  onChanged: () => void
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
  const replyID = `comment-reply-${thread.id}`
  return (
    <li className='flex flex-col gap-1.5 border-t border-border py-2 text-[12.5px]'>
      <div className='flex items-baseline justify-between gap-2'>
        <span className='font-medium'>{thread.authorName || 'Someone'}</span>
        <span className='font-mono text-[10.5px] text-muted-foreground'>
          {formatRelativeTime(thread.createdAt)}
        </span>
      </div>
      <p
        className={
          thread.resolvedAt ? 'text-muted-foreground line-through' : ''
        }
      >
        {thread.content}
      </p>
      {thread.replies.map((r) => (
        <div key={r.id} className='border-l border-border pl-2'>
          <span className='font-medium'>{r.authorName || 'Someone'}</span>{' '}
          <span>{r.content}</span>
        </div>
      ))}
      {canComment && (
        <div className='flex flex-col gap-1'>
          <label htmlFor={replyID} className='sr-only'>
            Reply to {thread.authorName || 'this comment'}
          </label>
          {!thread.resolvedAt && (
            <Textarea
              id={replyID}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
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
          </div>
        </div>
      )}
    </li>
  )
}

/** The threads on one element of the canvas, and a box to start a new one. */
export function ElementComments({
  workspaceID,
  documentID,
  elementID,
  elementName,
  canComment,
  onChanged,
}: {
  workspaceID: string
  documentID: string
  elementID: string
  elementName: string
  canComment: boolean
  onChanged: () => void
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
            onChanged={onChanged}
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
          <Textarea
            id={newID}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
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
            <p>{t.content}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
