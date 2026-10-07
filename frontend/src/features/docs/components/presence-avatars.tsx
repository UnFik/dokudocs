import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { authorColor } from '../lib/author-color'
import type { PresenceUser } from '../lib/collab-session'

const maxVisible = 4

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
  followedID = null,
  onFollow,
}: {
  users: PresenceUser[]
  currentUserID: string
  followedID?: string | null
  /** Called with a person's id to follow them, or null to stop. */
  onFollow?: (userID: string | null) => void
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
        const name = user.name || 'Anonymous'
        const avatar = (
          <Avatar
            className='size-6 border-2 ring-2 ring-background'
            style={{ borderColor: authorColor(user.userID) }}
          >
            {user.avatarURL ? (
              <AvatarImage src={user.avatarURL} alt='' />
            ) : null}
            <AvatarFallback className='bg-muted text-[10px] font-semibold text-foreground'>
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>
        )
        const followable = onFollow && user.userID !== currentUserID
        const following = followedID === user.userID
        return (
          <li key={user.userID} aria-label={label}>
            <Tooltip>
              <TooltipTrigger asChild>
                {followable ? (
                  <button
                    type='button'
                    aria-label={`${following ? 'Stop following' : 'Follow'} ${name}`}
                    aria-pressed={following}
                    className='rounded-full focus-visible:ring-2'
                    onClick={() => onFollow(following ? null : user.userID)}
                  >
                    {avatar}
                  </button>
                ) : (
                  <span className='inline-flex rounded-full'>{avatar}</span>
                )}
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          </li>
        )
      })}
      {hidden > 0 ? (
        <li
          aria-label={`${hidden} more people`}
          className='z-10 flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ring-2 ring-background'
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <span>+{hidden}</span>
            </TooltipTrigger>
            <TooltipContent>
              {users
                .slice(maxVisible)
                .map((user) => user.name || 'Anonymous')
                .join(', ')}
            </TooltipContent>
          </Tooltip>
        </li>
      ) : null}
    </ul>
  )
}
