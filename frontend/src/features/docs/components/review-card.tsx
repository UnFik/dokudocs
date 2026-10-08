import type { ReactNode } from 'react'
import { Check, Trash2, X } from 'lucide-react'
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
  actions,
}: {
  name: string
  createdAt?: string
  avatarURL?: string
  /** An author color around the avatar, for suggestions. */
  ringColor?: string
  /** Small extras after the time (edited, resolved). */
  note?: string
  /** Icon actions at the right end; use `CardIconButton` so they show on hover. */
  actions?: ReactNode
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
      <div className='min-w-0 flex-1 leading-tight'>
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
      {actions ? <div className='flex shrink-0 gap-0.5'>{actions}</div> : null}
    </div>
  )
}

/**
 * Quiet until the card is hovered, focused or chosen (always shown on touch
 * screens). The card must be a `group` and carry `data-focused` when chosen.
 */
export const revealOnHover =
  'opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 group-data-[focused=true]:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100'

/** An icon action in a card header: a check to accept or resolve, a cross to reject, a bin to delete. */
export function CardIconButton({
  label,
  kind,
  disabled,
  onClick,
}: {
  label: string
  kind: 'accept' | 'reject' | 'delete'
  disabled?: boolean
  onClick: () => void
}) {
  const Icon = kind === 'accept' ? Check : kind === 'delete' ? Trash2 : X
  // Meaning, not decoration: accepting is --ok, deleting is --destructive.
  const tone =
    kind === 'accept'
      ? 'text-ok hover:text-ok'
      : kind === 'delete'
        ? 'text-destructive hover:text-destructive'
        : 'text-muted-foreground hover:text-foreground'
  return (
    <Button
      type='button'
      variant='ghost'
      size='icon'
      className={`size-8 ${tone} ${revealOnHover}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className='size-4' strokeWidth={1.5} />
    </Button>
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
