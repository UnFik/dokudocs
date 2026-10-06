import { formatDistance } from 'date-fns'

/** Under the title: who changed the page last and when, whether it is a draft, and how many tasks are done. */
export function DocumentInfoLine({
  updatedAt,
  updatedBy,
  author,
  isDraft,
  tasks,
  now = new Date(),
}: {
  updatedAt: string
  updatedBy: string | null
  author: string
  isDraft: boolean
  tasks: { done: number; total: number }
  now?: Date
}) {
  const when = formatDistance(new Date(updatedAt), now, { addSuffix: true })
  const who = updatedBy ? `Updated by ${updatedBy}` : `Created by ${author}`
  return (
    <p className='flex flex-wrap items-center justify-center gap-x-3 text-center text-xs text-muted-foreground'>
      <span>{`${who} ${when}`}</span>
      {isDraft ? <span>Draft</span> : null}
      {tasks.total > 0 ? (
        <span>{`${tasks.done} of ${tasks.total} tasks done`}</span>
      ) : null}
    </p>
  )
}
