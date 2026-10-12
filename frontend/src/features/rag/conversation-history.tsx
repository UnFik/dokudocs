import { useState, type FormEvent } from 'react'
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Ellipsis,
  ExternalLink,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react'
import type { RAGConversation } from '@/lib/domain-api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { shortAge } from './conversation-format'

export type HistoryActions = {
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onPin: (id: string, pinned: boolean) => void
  onArchive: (id: string, archived: boolean) => void
  /** Where "open in AI chat" leads; left out where the list already is that page. */
  assistantHref?: (id: string) => string
  /** Deleting a chat for good; offered only where the page asks first. */
  onDelete?: (id: string) => void
  /** A muted second line under the name, such as the workspace. */
  subtitle?: (chat: RAGConversation) => string
}

const titleOf = (chat: RAGConversation) => chat.title.trim() || 'Untitled chat'

const quiet =
  'inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

/** The User's chats, pinned first, with the archived ones folded below. */
export function ConversationHistory({
  conversations,
  selectedID,
  loading,
  failed,
  problem,
  ...actions
}: HistoryActions & {
  conversations: RAGConversation[]
  selectedID?: string
  loading: boolean
  failed: boolean
  /** The last action the server refused, such as the pin limit. */
  problem?: string
}) {
  const [renaming, setRenaming] = useState<string>()
  const [showArchived, setShowArchived] = useState(false)
  const active = conversations.filter((chat) => !chat.archivedAt)
  const archived = conversations.filter((chat) => chat.archivedAt)

  const row = (chat: RAGConversation) => (
    <HistoryRow
      key={chat.id}
      chat={chat}
      selected={chat.id === selectedID}
      renaming={renaming === chat.id}
      onStartRename={() => setRenaming(chat.id)}
      onStopRename={() => setRenaming(undefined)}
      {...actions}
    />
  )

  return (
    <div className='min-h-0 flex-1 overflow-y-auto'>
      {loading ? (
        <p role='status' className='p-4 text-sm text-muted-foreground'>
          Loading chats…
        </p>
      ) : failed ? (
        <p role='alert' className='p-4 text-sm text-destructive'>
          Could not load the chats. Close this list and open it again to retry.
        </p>
      ) : active.length === 0 && archived.length === 0 ? (
        <p className='p-4 text-sm text-muted-foreground'>
          No chats yet. Use the plus in the header to start one.
        </p>
      ) : (
        <>
          {active.length > 0 ? (
            <ul aria-label='Chats' className='divide-y'>
              {active.map(row)}
            </ul>
          ) : null}
          {archived.length > 0 ? (
            <div className='border-t'>
              <button
                type='button'
                aria-expanded={showArchived}
                onClick={() => setShowArchived(!showArchived)}
                className='flex w-full items-center gap-2 px-4 py-3 text-left font-mono text-xs text-muted-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-sm:min-h-11'
              >
                <ChevronRight
                  className={cn('size-3.5', showArchived && 'rotate-90')}
                  aria-hidden='true'
                />
                Archived ({archived.length})
              </button>
              {showArchived ? (
                <ul aria-label='Archived chats' className='divide-y'>
                  {archived.map(row)}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      {problem ? (
        <p role='alert' className='border-t p-4 text-sm text-destructive'>
          {problem}
        </p>
      ) : null}
    </div>
  )
}

function HistoryRow({
  chat,
  selected,
  renaming,
  onStartRename,
  onStopRename,
  onSelect,
  onRename,
  onPin,
  onArchive,
  assistantHref,
  onDelete,
  subtitle,
}: HistoryActions & {
  chat: RAGConversation
  selected: boolean
  renaming: boolean
  onStartRename: () => void
  onStopRename: () => void
}) {
  const title = titleOf(chat)
  const pinned = Boolean(chat.pinnedAt)
  const archived = Boolean(chat.archivedAt)
  const [draft, setDraft] = useState(chat.title)

  const save = (event: FormEvent) => {
    event.preventDefault()
    const next = draft.trim()
    if (next && next !== chat.title) onRename(chat.id, next)
    onStopRename()
  }

  if (renaming)
    return (
      <li className='px-4 py-2'>
        <form onSubmit={save}>
          <input
            autoFocus
            aria-label='Chat name'
            value={draft}
            maxLength={120}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onStopRename()
              }
            }}
            className='h-9 w-full rounded-sm border border-input bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
          />
        </form>
      </li>
    )

  return (
    <li
      className={cn(
        'group relative transition-colors hover:bg-accent',
        selected && 'bg-card'
      )}
    >
      <button
        type='button'
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(chat.id)}
        className='flex w-full items-center gap-3 px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset max-sm:min-h-11'
      >
        <MessageSquare
          className='size-4 shrink-0 text-muted-foreground'
          aria-hidden='true'
        />
        <span className='min-w-0 flex-1'>
          <span className='block truncate text-sm font-medium'>{title}</span>
          {subtitle ? (
            <span className='block truncate text-xs text-muted-foreground'>
              {subtitle(chat)}
            </span>
          ) : null}
        </span>
        {chat.unread ? (
          <span className='flex shrink-0 items-center gap-1.5 font-mono text-[11px]'>
            <span
              className='size-1.5 rounded-[1px] bg-foreground'
              aria-hidden='true'
            />
            Unread
          </span>
        ) : null}
        <span className='shrink-0 font-mono text-xs text-muted-foreground tabular-nums'>
          {shortAge(chat.updatedAt)}
        </span>
      </button>
      <div className='absolute inset-y-0 end-2 hidden items-center gap-0.5 bg-accent ps-2 group-focus-within:flex group-hover:flex [@media(hover:none)]:hidden'>
        {assistantHref ? (
          <a
            href={assistantHref(chat.id)}
            aria-label={`Open ${title} in AI chat`}
            title='Open in AI chat'
            className={quiet}
          >
            <ExternalLink className='size-4' />
          </a>
        ) : null}
        <button
          type='button'
          aria-label={`Rename ${title}`}
          title='Rename'
          onClick={onStartRename}
          className={quiet}
        >
          <Pencil className='size-4' />
        </button>
        <button
          type='button'
          aria-label={`${archived ? 'Restore' : 'Archive'} ${title}`}
          title={archived ? 'Restore' : 'Archive'}
          onClick={() => onArchive(chat.id, !archived)}
          className={quiet}
        >
          {archived ? (
            <ArchiveRestore className='size-4' />
          ) : (
            <Archive className='size-4' />
          )}
        </button>
        <button
          type='button'
          aria-label={`${pinned ? 'Unpin' : 'Pin'} ${title}`}
          aria-pressed={pinned}
          title={pinned ? 'Unpin' : 'Pin'}
          onClick={() => onPin(chat.id, !pinned)}
          className={quiet}
        >
          {pinned ? <PinOff className='size-4' /> : <Pin className='size-4' />}
        </button>
        {onDelete ? (
          <button
            type='button'
            aria-label='Delete chat'
            title='Delete chat'
            onClick={() => onDelete(chat.id)}
            className={quiet}
          >
            <Trash2 className='size-4' />
          </button>
        ) : null}
      </div>
      {/* There is no hover on a touch screen, so the same four actions live in a menu. */}
      <div className='absolute inset-y-0 end-1 hidden items-center [@media(hover:none)]:flex'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              aria-label={`Actions for ${title}`}
              className='size-11'
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            {assistantHref ? (
              <DropdownMenuItem asChild>
                <a href={assistantHref(chat.id)}>Open in AI chat</a>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={onStartRename}>Rename</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onArchive(chat.id, !archived)}>
              {archived ? 'Restore' : 'Archive'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onPin(chat.id, !pinned)}>
              {pinned ? 'Unpin' : 'Pin'}
            </DropdownMenuItem>
            {onDelete ? (
              <DropdownMenuItem onSelect={() => onDelete(chat.id)}>
                Delete
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}
