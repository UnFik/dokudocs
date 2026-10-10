import { useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import type { CommentThread, SourceCommentAnchor } from '@/lib/domain-api'
import { Button } from '@/components/ui/button'
import type { SourceRanges } from '../lib/source-comment-marks'
import { CommentCard, NewCommentCard } from './comment-card'

/** The comments of a DBML or Mermaid source, in the order their words come in the file. */
export function SourceCommentsPanel({
  workspaceID,
  documentID,
  userID,
  threads,
  ranges,
  loading,
  failed,
  canComment,
  canDecide,
  hasSelection,
  draft,
  focusedID,
  onSelect,
  onStartDraft,
  onDraftDone,
}: {
  workspaceID: string
  documentID: string
  userID: string
  threads: CommentThread[]
  ranges: SourceRanges
  loading: boolean
  failed: boolean
  canComment: boolean
  canDecide: boolean
  hasSelection: boolean
  draft: { selectedText: string; anchor: SourceCommentAnchor } | null
  focusedID: string | null
  onSelect: (id: string) => void
  onStartDraft: () => void
  onDraftDone: () => void
}) {
  const [showResolved, setShowResolved] = useState(false)
  const sourceThreads = threads.filter((thread) => thread.sourceAnchor)
  const open = sourceThreads
    .filter((thread) => !thread.resolvedAt)
    .sort(
      (a, b) =>
        // A thread whose words are gone goes last.
        (ranges.get(a.id)?.from ?? Infinity) -
        (ranges.get(b.id)?.from ?? Infinity)
    )
  const resolved = sourceThreads.filter((thread) => thread.resolvedAt)
  const card = (thread: CommentThread) => (
    <CommentCard
      key={thread.id}
      thread={thread}
      userID={userID}
      canInteract={canComment}
      canDecide={canDecide}
      orphaned={!thread.resolvedAt && !ranges.get(thread.id)}
      focused={focusedID === thread.id}
      workspaceID={workspaceID}
      documentID={documentID}
      onSelect={onSelect}
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
            disabled={!hasSelection || draft !== null}
            onClick={onStartDraft}
          >
            <MessageSquarePlus className='size-3.5' aria-hidden />
            Comment on selection
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
            {open.length === 0 && !draft && resolved.length === 0 ? (
              <p className='text-muted-foreground'>
                No comments yet.
                {canComment
                  ? ' Select some source in the editor, then choose Comment on selection.'
                  : ''}
              </p>
            ) : null}
            <ul aria-label='Comments on the source'>
              {draft ? (
                <NewCommentCard
                  workspaceID={workspaceID}
                  documentID={documentID}
                  selectedText={draft.selectedText}
                  anchor={draft.anchor}
                  onDone={onDraftDone}
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
                  ? 'Hide resolved comments'
                  : `Show ${resolved.length} resolved ${resolved.length === 1 ? 'comment' : 'comments'}`}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </aside>
  )
}
