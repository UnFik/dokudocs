import { useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import type { CommentThread } from '@/lib/domain-api'
import { Button } from '@/components/ui/button'
import { CommentCard, NewCommentCard } from './comment-card'

/** Comments on a whole page. An HTML document has no text to select, so a thread is about the page. */
export function PageCommentsPanel({
  workspaceID,
  documentID,
  userID,
  threads,
  loading,
  failed,
  canComment,
  canDecide,
}: {
  workspaceID: string
  documentID: string
  userID: string
  threads: CommentThread[]
  loading: boolean
  failed: boolean
  canComment: boolean
  canDecide: boolean
}) {
  const [showResolved, setShowResolved] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const open = threads.filter((thread) => !thread.resolvedAt)
  const resolved = threads.filter((thread) => thread.resolvedAt)
  const card = (thread: CommentThread) => (
    <CommentCard
      key={thread.id}
      thread={thread}
      userID={userID}
      canInteract={canComment}
      canDecide={canDecide}
      orphaned={false}
      focused={false}
      workspaceID={workspaceID}
      documentID={documentID}
      onSelect={() => {}}
    />
  )

  return (
    <aside
      aria-label='Comments'
      className='flex h-full w-80 shrink-0 flex-col border-l border-border bg-card'
    >
      <div className='flex items-center justify-between gap-2 border-b border-border px-3 py-2'>
        <h2 className='text-[13px] font-medium'>Comments</h2>
        {canComment ? (
          <Button
            size='sm'
            variant='outline'
            className='h-7 gap-1.5 px-2 text-xs'
            disabled={drafting}
            onClick={() => setDrafting(true)}
          >
            <MessageSquarePlus className='size-3.5' aria-hidden />
            Comment on the page
          </Button>
        ) : null}
      </div>
      <div className='flex-1 overflow-auto px-3 py-2 text-xs'>
        {loading ? (
          <p className='text-muted-foreground'>Loading comments…</p>
        ) : failed ? (
          <p role='alert' className='text-destructive'>
            Could not load comments. Check your connection and reload the page.
          </p>
        ) : (
          <>
            {!canComment ? (
              <p className='mb-2 text-muted-foreground'>
                You can read comments here. Ask the owner for comment access to
                write one.
              </p>
            ) : null}
            {open.length === 0 && !drafting && resolved.length === 0 ? (
              <p className='text-muted-foreground'>
                No comments yet. Comments here are about the page as a whole.
              </p>
            ) : null}
            <ul aria-label='Comments on the page'>
              {drafting ? (
                <NewCommentCard
                  workspaceID={workspaceID}
                  documentID={documentID}
                  selectedText=''
                  onDone={() => setDrafting(false)}
                />
              ) : null}
              {open.map(card)}
              {showResolved ? resolved.map(card) : null}
            </ul>
            {resolved.length > 0 ? (
              <Button
                size='sm'
                variant='ghost'
                className='-ml-2 h-7 px-2 text-xs'
                aria-expanded={showResolved}
                onClick={() => setShowResolved((shown) => !shown)}
              >
                {showResolved
                  ? 'Hide resolved'
                  : `Show ${resolved.length} resolved`}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </aside>
  )
}
