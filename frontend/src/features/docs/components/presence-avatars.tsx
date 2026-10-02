import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { PresenceUser } from '../lib/collaboration-socket'

const maxVisible = 4

const palette = [
  'bg-rose-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-sky-500',
  'bg-violet-500',
  'bg-fuchsia-500',
  'bg-teal-500',
  'bg-orange-500',
]

function colorFor(userID: string) {
  let hash = 0
  for (const char of userID) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return palette[hash % palette.length]
}

function initials(name: string | undefined) {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? []
  if (!words.length) return '?'
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')
}

export function PresenceAvatars({
  users,
  currentUserID,
}: {
  users: PresenceUser[]
  currentUserID: string
}) {
  if (!users.length) return null
  const visible = users.slice(0, maxVisible)
  const hidden = users.length - visible.length
  return (
    <ul
      aria-label='People in this document'
      className='flex items-center -space-x-1.5'
    >
      {visible.map((user) => {
        const label = `${user.name || 'Anonymous'}${user.userID === currentUserID ? ' (you)' : ''}`
        return (
          <li key={user.userID} aria-label={label} title={label}>
            <Avatar className='size-6 ring-2 ring-background'>
              {user.avatarURL ? (
                <AvatarImage src={user.avatarURL} alt='' />
              ) : null}
              <AvatarFallback
                className={`${colorFor(user.userID)} text-[10px] font-semibold text-white`}
              >
                {initials(user.name)}
              </AvatarFallback>
            </Avatar>
          </li>
        )
      })}
      {hidden > 0 ? (
        <li
          aria-label={`${hidden} more people`}
          title={`${hidden} more people`}
          className='z-10 flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ring-2 ring-background'
        >
          +{hidden}
        </li>
      ) : null}
    </ul>
  )
}
