import { useState } from 'react'
import {
  Bold,
  Code,
  Italic,
  Link2,
  Link2Off,
  MessageSquarePlus,
  Redo2,
  Highlighter,
  Strikethrough,
  Underline,
  Undo2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { EditorHistoryState } from '../lib/prosemirror/createDocumentBodyEditor'
import type {
  InlineMarkName,
  InlineState,
} from '../lib/prosemirror/inlineMarks'

// Widest state: mark buttons plus the link field and its apply button.
const TOOLBAR_MAX_WIDTH = 340

// Keep the editor selection: a button press must not move focus off the text.
const keepSelection = (event: React.MouseEvent) => event.preventDefault()

export function HistoryButtons({
  history,
  disabled = false,
  onUndo,
  onRedo,
}: {
  history: EditorHistoryState
  disabled?: boolean
  onUndo: () => void
  onRedo: () => void
}) {
  return (
    <div className='flex items-center gap-1' role='group' aria-label='History'>
      <Button
        size='icon'
        variant='ghost'
        className='size-8 max-sm:size-11 pointer-coarse:size-11'
        aria-label='Undo'
        title='Undo (Ctrl+Z)'
        disabled={disabled || !history.canUndo}
        onMouseDown={keepSelection}
        onClick={onUndo}
      >
        <Undo2 />
      </Button>
      <Button
        size='icon'
        variant='ghost'
        className='size-8 max-sm:size-11 pointer-coarse:size-11'
        aria-label='Redo'
        title='Redo (Ctrl+Shift+Z)'
        disabled={disabled || !history.canRedo}
        onMouseDown={keepSelection}
        onClick={onRedo}
      >
        <Redo2 />
      </Button>
    </div>
  )
}

const markButtons: {
  mark: InlineMarkName
  label: string
  shortcut: string
  icon: typeof Bold
}[] = [
  { mark: 'strong', label: 'Bold', shortcut: 'Ctrl+B', icon: Bold },
  { mark: 'em', label: 'Italic', shortcut: 'Ctrl+I', icon: Italic },
  {
    mark: 'strike',
    label: 'Strikethrough',
    shortcut: 'Ctrl+Shift+X',
    icon: Strikethrough,
  },
  { mark: 'code', label: 'Inline code', shortcut: 'Ctrl+E', icon: Code },
  {
    mark: 'underline',
    label: 'Underline',
    shortcut: 'Ctrl+U',
    icon: Underline,
  },
  {
    mark: 'highlight',
    label: 'Highlight',
    shortcut: '==text==',
    icon: Highlighter,
  },
]

export function SelectionToolbar({
  inline,
  onToggleMark,
  onSetLink,
  onRemoveLink,
  linkRequest,
  onComment,
}: {
  inline: InlineState
  onToggleMark: (mark: InlineMarkName) => void
  onSetLink: (href: string) => boolean
  onRemoveLink: () => void
  /** Bumped by the editor when Ctrl+K asks for a link field. */
  linkRequest: number
  /** Starts a comment on the selected text; omitted when the reader cannot comment. */
  onComment?: () => void
}) {
  const [linkOpen, setLinkOpen] = useState(false)
  const [href, setHref] = useState('')
  const [error, setError] = useState('')
  const [seenRequest, setSeenRequest] = useState(linkRequest)
  if (seenRequest !== linkRequest) {
    setSeenRequest(linkRequest)
    setLinkOpen(true)
    setHref(inline.link ?? '')
    setError('')
  }

  if (!inline.hasSelection || !inline.rect) return null

  const closeLink = () => {
    setLinkOpen(false)
    setError('')
  }
  const applyLink = () => {
    if (onSetLink(href)) closeLink()
    else setError('Enter an http, https, mailto, tel, or relative address.')
  }

  return (
    <div
      role='toolbar'
      aria-label='Format selection'
      className='fixed z-50 flex max-w-[calc(100vw-1rem)] flex-col gap-1 rounded-md border bg-popover p-1 text-popover-foreground shadow-sm'
      style={{
        top: Math.max(8, inline.rect.top - 44),
        left: Math.max(
          8,
          Math.min(inline.rect.left, window.innerWidth - TOOLBAR_MAX_WIDTH - 8)
        ),
      }}
    >
      <div className='flex flex-wrap items-center gap-0.5'>
        {markButtons.map(({ mark, label, shortcut, icon: Icon }) => (
          <Button
            key={mark}
            size='icon'
            variant={inline.marks[mark] ? 'secondary' : 'ghost'}
            className='size-8 max-sm:size-11 pointer-coarse:size-11'
            aria-label={label}
            aria-pressed={inline.marks[mark]}
            title={`${label} (${shortcut})`}
            onMouseDown={keepSelection}
            onClick={() => onToggleMark(mark)}
          >
            <Icon />
          </Button>
        ))}
        {inline.link ? (
          <Button
            size='icon'
            variant='ghost'
            className='size-8 max-sm:size-11 pointer-coarse:size-11'
            aria-label='Remove link'
            title='Remove link'
            onMouseDown={keepSelection}
            onClick={onRemoveLink}
          >
            <Link2Off />
          </Button>
        ) : null}
        <Button
          size='icon'
          variant={inline.link ? 'secondary' : 'ghost'}
          className='size-8 max-sm:size-11 pointer-coarse:size-11'
          aria-label='Link'
          aria-pressed={Boolean(inline.link)}
          title='Link (Ctrl+K)'
          onMouseDown={keepSelection}
          onClick={() => {
            setHref(inline.link ?? '')
            setError('')
            setLinkOpen((open) => !open)
          }}
        >
          <Link2 />
        </Button>
        {onComment ? (
          <Button
            size='icon'
            variant='ghost'
            className='size-8 max-sm:size-11 pointer-coarse:size-11'
            aria-label='Add comment'
            title='Add comment (Ctrl+Alt+M)'
            onMouseDown={keepSelection}
            onClick={onComment}
          >
            <MessageSquarePlus />
          </Button>
        ) : null}
      </div>
      {linkOpen ? (
        <form
          className='flex flex-col gap-1 p-1'
          onSubmit={(event) => {
            event.preventDefault()
            applyLink()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              closeLink()
            }
          }}
        >
          <div className='flex items-center gap-1'>
            <Input
              autoFocus
              aria-label='Link address'
              aria-invalid={Boolean(error)}
              className='h-8 w-40 max-sm:h-11 sm:w-56 pointer-coarse:h-11'
              placeholder='https://example.com'
              value={href}
              onChange={(event) => setHref(event.target.value)}
            />
            <Button
              type='submit'
              size='sm'
              variant='default'
              className='max-sm:h-11 pointer-coarse:h-11'
            >
              Apply link
            </Button>
          </div>
          {error ? (
            <p role='alert' className='text-xs text-destructive'>
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  )
}
