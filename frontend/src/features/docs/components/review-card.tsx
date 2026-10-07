import type { ReactNode } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { reviewTime } from '../lib/review-time'

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

/** Who and when, at the top of a card in the review rail: the avatar, the name, the time under it. */
export function ReviewCardHeader({
  name,
  createdAt,
  avatarURL,
  ringColor,
  note,
}: {
  name: string
  createdAt?: string
  avatarURL?: string
  /** An author color around the avatar, for suggestions. */
  ringColor?: string
  /** Small extras after the time (edited, resolved). */
  note?: string
}) {
  return (
    <div className='flex min-w-0 items-center gap-3'>
      <Avatar
        aria-hidden
        className='size-9 shrink-0 border-2'
        style={ringColor ? { borderColor: ringColor } : undefined}
      >
        {avatarURL ? <AvatarImage src={avatarURL} alt='' /> : null}
        <AvatarFallback className='bg-muted text-xs leading-none font-medium text-muted-foreground'>
          {initials(name)}
        </AvatarFallback>
      </Avatar>
      <div className='min-w-0 leading-tight'>
        <p className='truncate text-sm font-semibold text-foreground'>{name}</p>
        {createdAt || note ? (
          <p className='text-xs text-muted-foreground'>
            {createdAt ? (
              <time dateTime={createdAt} className='tabular-nums'>
                {reviewTime(createdAt)}
              </time>
            ) : null}
            {note ? <span>{createdAt ? ` · ${note}` : note}</span> : null}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** "Add: “text”": the label in bold, what was typed or removed in italic. */
export function SuggestionTitle({ title }: { title: string }) {
  const labelled = /^(Add|Delete|Replace|Format):\s*(.*)$/s.exec(title)
  if (!labelled) return <>{title}</>
  const parts = labelled[2]!.split(/"([^"]*)"/)
  return (
    <>
      <strong className='font-semibold'>{labelled[1]}:</strong>{' '}
      {parts.map((part, index) =>
        index % 2 ? (
          <em key={index}>{`“${part}”`}</em>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  )
}

/**
 * A card offers Reply as a quiet button that shows when the card is hovered or
 * focused (always on touch screens); the box appears once it is pressed. The
 * card must be a `group`.
 */
export function ReplyReveal({
  open,
  onOpen,
  children,
}: {
  open: boolean
  onOpen: () => void
  children: ReactNode
}) {
  if (open) return <>{children}</>
  return (
    <Button
      type='button'
      variant='ghost'
      size='sm'
      className='mt-1 -ml-2 h-7 px-2 text-xs text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100'
      onClick={onOpen}
    >
      Reply
    </Button>
  )
}
