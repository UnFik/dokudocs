import type { ReactNode } from 'react'
import {
  ChevronDown,
  Download,
  Ellipsis,
  MessageSquareText,
  Plus,
  Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import type { ChatPreferences } from './chat-preferences'

const iconButton = 'max-sm:size-11'

/**
 * The one-row header of the AI panel: the chat's name (it opens the history),
 * the options that apply everywhere, a new chat, and, when the panel can be
 * closed, a close button after a divider.
 */
export function ChatPanelHeader({
  title,
  historyOpen,
  onToggleHistory,
  onNew,
  newDisabled,
  canDownload,
  onDownload,
  preferences,
  onSound,
  onBrowser,
  browserBlocked,
  close,
}: {
  title: string
  /** Left out where the list of chats is always on screen; the name is then plain text. */
  historyOpen?: boolean
  onToggleHistory?: () => void
  onNew: () => void
  newDisabled?: boolean
  canDownload: boolean
  onDownload: () => void
  preferences: ChatPreferences
  onSound: (on: boolean) => void
  onBrowser: (on: boolean) => void
  /** The browser refused notifications, so the switch cannot turn on. */
  browserBlocked: boolean
  close?: ReactNode
}) {
  const name = title.trim() || 'Untitled chat'
  return (
    <div className='flex h-12 shrink-0 items-center gap-1 border-b px-2'>
      <MessageSquareText
        className='mx-1 size-4 shrink-0 text-muted-foreground'
        aria-hidden='true'
      />
      {onToggleHistory ? (
        <button
          type='button'
          aria-expanded={historyOpen}
          aria-label={`Chat history, ${name}`}
          onClick={onToggleHistory}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1 rounded-sm px-2 py-1.5 text-left text-sm font-medium transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-sm:min-h-11',
            historyOpen && 'bg-accent'
          )}
        >
          <span className='truncate'>{name}</span>
          <ChevronDown
            className='size-3.5 shrink-0 text-muted-foreground'
            aria-hidden='true'
          />
        </button>
      ) : (
        <h2 className='min-w-0 flex-1 truncate px-2 text-sm font-medium'>
          {name}
        </h2>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            aria-label='Chat options'
            className={iconButton}
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-72'>
          <DropdownMenuItem disabled={!canDownload} onSelect={onDownload}>
            <Download />
            Download conversation
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href='/settings/ai'>
              <Settings />
              Settings
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={preferences.sound}
            onCheckedChange={onSound}
            onSelect={(event) => event.preventDefault()}
          >
            Play notification sound when completed
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={preferences.browser}
            disabled={browserBlocked && !preferences.browser}
            onCheckedChange={onBrowser}
            onSelect={(event) => event.preventDefault()}
          >
            Browser notification
          </DropdownMenuCheckboxItem>
          {browserBlocked ? (
            <p
              role='status'
              className='px-8 pb-1.5 text-xs text-muted-foreground'
            >
              This browser blocked notifications for DokuDocs. Allow them in the
              site settings to turn this on.
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant='ghost'
        size='icon'
        aria-label='New chat'
        disabled={newDisabled}
        onClick={onNew}
        className={iconButton}
      >
        <Plus />
      </Button>
      {close ? (
        <>
          <Separator orientation='vertical' className='mx-1 h-5' />
          {close}
        </>
      ) : null}
    </div>
  )
}
