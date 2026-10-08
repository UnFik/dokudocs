import { useState } from 'react'
import {
  Bold,
  ChevronsUpDown,
  Code,
  CornerDownLeft,
  ExternalLink,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  ListTodo,
  MessageSquarePlus,
  Quote,
  Redo2,
  Highlighter,
  Strikethrough,
  Undo2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { EditorHistoryState } from '../lib/prosemirror/createDocumentBodyEditor'
import { normalizeLinkTarget } from '../lib/prosemirror/inlineMarks'
import type {
  BlockKind,
  InlineMarkName,
  InlineState,
} from '../lib/prosemirror/inlineMarks'
import type { WrapKind } from '../lib/prosemirror/markdownBlockRules'

// Widest state: mark buttons plus the link field and its apply button.
const TOOLBAR_MAX_WIDTH = 460

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
  {
    mark: 'highlight',
    label: 'Highlight',
    shortcut: '==text==',
    icon: Highlighter,
  },
  { mark: 'code', label: 'Inline code', shortcut: 'Ctrl+E', icon: Code },
]

const headingButtons: { level: 1 | 2 | 3; block: BlockKind }[] = [
  { level: 1, block: 'heading-1' },
  { level: 2, block: 'heading-2' },
  { level: 3, block: 'heading-3' },
]

const wrapButtons: {
  kind: WrapKind
  label: string
  icon: typeof List
}[] = [
  { kind: 'quote', label: 'Quote', icon: Quote },
  { kind: 'toggle', label: 'Toggle block', icon: ChevronsUpDown },
  { kind: 'task-list', label: 'Task list', icon: ListTodo },
  { kind: 'bullet-list', label: 'Bulleted list', icon: List },
  { kind: 'ordered-list', label: 'Numbered list', icon: ListOrdered },
]

const buttonSize = 'size-8 max-sm:size-11 pointer-coarse:size-11'

function Separator() {
  return (
    <div
      role='separator'
      aria-orientation='vertical'
      className='mx-1 h-5 w-px shrink-0 bg-border'
    />
  )
}

export function SelectionToolbar({
  inline,
  onToggleMark,
  onSetLink,
  onRemoveLink,
  linkRequest,
  onComment,
  onSetHeading,
  onWrapBlock,
}: {
  inline: InlineState
  onToggleMark: (mark: InlineMarkName) => void
  onSetLink: (href: string) => boolean
  onRemoveLink: () => void
  /** Bumped by the editor when Ctrl+K asks for a link field. */
  linkRequest: number
  /** Starts a comment on the selected text; omitted when the reader cannot comment. */
  onComment?: () => void
  /** Sets the heading level of the line; 0 turns a heading back into text. */
  onSetHeading: (level: 0 | 1 | 2 | 3) => void
  /** Wraps the line in a list, quote or toggle; omitted where a mode cannot do it. */
  onWrapBlock?: (kind: WrapKind) => void
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

  const wrapButton = ({
    kind,
    label,
    icon: Icon,
  }: (typeof wrapButtons)[number]) => {
    const active = inline.block === kind
    return (
      <Button
        key={kind}
        size='icon'
        variant={active ? 'secondary' : 'ghost'}
        className={buttonSize}
        aria-label={label}
        aria-pressed={active}
        title={label}
        disabled={!active && (!onWrapBlock || inline.block !== 'paragraph')}
        onMouseDown={keepSelection}
        onClick={() => {
          if (!active) onWrapBlock?.(kind)
        }}
      >
        <Icon />
      </Button>
    )
  }

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
      {linkOpen ? null : (
        <div className='flex flex-wrap items-center gap-0.5'>
          {headingButtons.map(({ level, block }) => (
            <Button
              key={level}
              size='icon'
              variant={inline.block === block ? 'secondary' : 'ghost'}
              className={`${buttonSize} text-xs font-semibold`}
              aria-label={`Heading ${level}`}
              aria-pressed={inline.block === block}
              title={`Heading ${level}`}
              onMouseDown={keepSelection}
              onClick={() => onSetHeading(inline.block === block ? 0 : level)}
            >
              {`H${level}`}
            </Button>
          ))}
          {wrapButtons.slice(0, 1).map((button) => wrapButton(button))}
          <Separator />
          {wrapButtons.slice(1, 2).map((button) => wrapButton(button))}
          <Separator />
          {wrapButtons.slice(2).map((button) => wrapButton(button))}
          <Separator />
          {markButtons.map(({ mark, label, shortcut, icon: Icon }) => (
            <Button
              key={mark}
              size='icon'
              variant={inline.marks[mark] ? 'secondary' : 'ghost'}
              className={buttonSize}
              aria-label={label}
              aria-pressed={inline.marks[mark]}
              title={`${label} (${shortcut})`}
              onMouseDown={keepSelection}
              onClick={() => onToggleMark(mark)}
            >
              <Icon />
            </Button>
          ))}
          <Separator />
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
      )}
      {linkOpen ? (
        <form
          className='flex flex-col gap-1'
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
              className='h-8 w-56 max-sm:h-11 sm:w-72 pointer-coarse:h-11'
              placeholder='Search or paste a link…'
              value={href}
              onChange={(event) => setHref(event.target.value)}
            />
            <Button
              asChild
              size='icon'
              variant='ghost'
              className={buttonSize}
              aria-disabled={!normalizeLinkTarget(href)}
            >
              <a
                aria-label='Open link'
                title='Open link'
                href={normalizeLinkTarget(href) ?? undefined}
                target='_blank'
                rel='noopener noreferrer'
                onMouseDown={keepSelection}
              >
                <ExternalLink />
              </a>
            </Button>
            <Button
              type='button'
              size='icon'
              variant='ghost'
              className={buttonSize}
              aria-label='Close link field'
              title='Close (Esc)'
              onMouseDown={keepSelection}
              onClick={closeLink}
            >
              <X />
            </Button>
            <Button
              type='submit'
              size='icon'
              variant='ghost'
              className={buttonSize}
              aria-label='Apply link'
              title='Apply link (Enter)'
            >
              <CornerDownLeft />
            </Button>
          </div>
          {error ? (
            <p role='alert' className='px-1 text-xs text-destructive'>
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  )
}
