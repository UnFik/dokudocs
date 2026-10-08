import { formatDistance } from 'date-fns'
import { MessageSquare } from 'lucide-react'

/** Under the title: who changed the page last and when, whether it is a draft, and how many tasks are done. */
export function DocumentInfoLine({
  updatedAt,
  updatedBy,
  author,
  isDraft,
  tasks,
  onToggleComments,
  commentsOpen,
  now = new Date(),
}: {
  updatedAt: string
  updatedBy: string | null
  author: string
  isDraft: boolean
  tasks: { done: number; total: number }
  /** Opens or closes the comments and suggestions panel; left out when there is none. */
  onToggleComments?: () => void
  commentsOpen?: boolean
  now?: Date
}) {
  const when = formatDistance(new Date(updatedAt), now, { addSuffix: true })
  const who = updatedBy ? `Updated by ${updatedBy}` : `Created by ${author}`
  return (
    <p className='flex flex-wrap items-center justify-center gap-x-3 text-center text-xs text-muted-foreground'>
      <span>{`${who} ${when}`}</span>
      {onToggleComments ? (
        <button
          type='button'
          className='inline-flex items-center gap-1 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal'
          aria-expanded={commentsOpen}
          aria-controls='suggestion-panel'
          onClick={onToggleComments}
        >
          <MessageSquare className='size-3.5' strokeWidth={1.5} />
          Comment
        </button>
      ) : null}
      {isDraft ? <span>Draft</span> : null}
      {tasks.total > 0 ? (
        <span>{`${tasks.done} of ${tasks.total} tasks done`}</span>
      ) : null}
    </p>
  )
}
