import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  activeMentionQuery,
  deserialize,
  serialize,
  trackEdit,
  type PlacedMention,
} from '@/lib/comment-mentions'
import { listMentionable, type MentionCandidate } from '@/lib/domain-api'
import { cn } from '@/lib/utils'
import { Textarea } from '@/components/ui/textarea'

const MAX_SHOWN = 8

type Props = Omit<
  React.ComponentProps<typeof Textarea>,
  'value' | 'onChange' | 'defaultValue'
> & {
  workspaceID: string
  documentID: string
  /** The comment as stored: a person is a token, @[Name](user:id). */
  value: string
  onValueChange: (value: string) => void
}

/** A name that fits inside a token: what the backend would write for the person. */
function labelOf(name: string): string {
  return name
    .replace(/[[\]()@\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

function narrow(people: MentionCandidate[], query: string): MentionCandidate[] {
  const needle = query.trim().toLowerCase()
  const rank = (person: MentionCandidate) => {
    const name = person.name.toLowerCase()
    if (name.startsWith(needle)) return 0
    if (name.split(/\s+/).some((word) => word.startsWith(needle))) return 1
    return 2
  }
  return people
    .filter(
      (person) =>
        !needle ||
        person.name.toLowerCase().includes(needle) ||
        person.email.toLowerCase().includes(needle)
    )
    .sort(
      (a, b) =>
        Number(b.canRead) - Number(a.canRead) ||
        rank(a) - rank(b) ||
        a.name.localeCompare(b.name)
    )
    .slice(0, MAX_SHOWN)
}

/**
 * A comment box where typing @ offers the people of the workspace, narrowing as
 * the name is typed. The box reads @Name; the value it reports has the tokens.
 */
export function MentionTextarea({
  workspaceID,
  documentID,
  value,
  onValueChange,
  onKeyDown,
  onFocus,
  onSelect,
  ...rest
}: Props) {
  const [model, setModel] = useState(() => deserialize(value))
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setModel(deserialize(value))
  }
  const { text, mentions } = model

  const [caret, setCaret] = useState(text.length)
  const [engaged, setEngaged] = useState(false)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const [activeID, setActiveID] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const nextCaret = useRef<number | null>(null)
  const listID = useId()

  const people = useQuery({
    queryKey: ['mentionable', workspaceID, documentID],
    queryFn: ({ signal }) => listMentionable(workspaceID, documentID, signal),
    enabled: engaged && Boolean(workspaceID && documentID),
    staleTime: 30_000,
    retry: false,
  })

  const typing = activeMentionQuery(text, caret, mentions)
  const query = typing && typing.start !== dismissedAt ? typing : null
  const shown = useMemo(
    () => (query && people.data ? narrow(people.data, query.query) : []),
    [query, people.data]
  )
  const choosable = shown.filter((person) => person.canRead)
  const active =
    choosable.find((person) => person.userId === activeID) ?? choosable[0]

  useEffect(() => {
    if (nextCaret.current === null || !ref.current) return
    ref.current.setSelectionRange(nextCaret.current, nextCaret.current)
    nextCaret.current = null
  })

  function commit(nextText: string, nextMentions: PlacedMention[]) {
    const content = serialize(nextText, nextMentions)
    setModel({ text: nextText, mentions: nextMentions })
    setSeen(content)
    onValueChange(content)
  }

  function choose(person: MentionCandidate) {
    if (!query || !person.canRead) return
    const label = labelOf(person.name)
    const inserted = `@${label} `
    const nextText = text.slice(0, query.start) + inserted + text.slice(caret)
    const carried = trackEdit(mentions, text, nextText)
    commit(nextText, [
      ...carried,
      {
        start: query.start,
        end: query.start + 1 + label.length,
        userID: person.userId,
        label,
      },
    ])
    nextCaret.current = query.start + inserted.length
    setCaret(nextCaret.current)
    setActiveID(null)
    ref.current?.focus()
  }

  // A dialog or popover around the box closes on Escape from a listener of its
  // own on the document; this one runs first, so Escape closes only the list.
  const openAt = query?.start ?? null
  useEffect(() => {
    if (openAt === null) return
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      event.preventDefault()
      setDismissedAt(openAt)
    }
    window.addEventListener('keydown', close, true)
    return () => window.removeEventListener('keydown', close, true)
  }, [openAt])

  function onKey(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (query) {
      if (shown.length > 0) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          if (choosable.length > 0) {
            const at = choosable.findIndex(
              (person) => person.userId === active?.userId
            )
            const step = event.key === 'ArrowDown' ? 1 : -1
            const next =
              choosable[(at + step + choosable.length) % choosable.length]
            setActiveID(next.userId)
          }
          return
        }
        if (
          (event.key === 'Enter' || event.key === 'Tab') &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey
        ) {
          event.preventDefault()
          if (active) choose(active)
          return
        }
      }
    }
    onKeyDown?.(event)
  }

  const open = query !== null
  const optionID = (person: MentionCandidate) => `${listID}-${person.userId}`

  return (
    <div className='relative'>
      <Textarea
        {...rest}
        ref={ref}
        value={text}
        aria-autocomplete='list'
        aria-haspopup='listbox'
        aria-controls={open ? listID : undefined}
        aria-activedescendant={open && active ? optionID(active) : undefined}
        onChange={(event) => {
          const next = event.target.value
          commit(next, trackEdit(mentions, text, next))
          setCaret(event.target.selectionStart)
          setActiveID(null)
        }}
        onSelect={(event) => {
          setCaret(event.currentTarget.selectionStart)
          onSelect?.(event)
        }}
        onFocus={(event) => {
          setEngaged(true)
          onFocus?.(event)
        }}
        onKeyDown={onKey}
      />
      {open && (
        <div
          className='absolute inset-x-0 top-full z-50 mt-1 max-h-56 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-sm'
          onMouseDown={(event) => event.preventDefault()}
        >
          {people.isPending ? (
            <p className='px-2 py-1.5 text-xs text-muted-foreground'>
              Loading people
            </p>
          ) : people.isError ? (
            <p className='px-2 py-1.5 text-xs text-destructive'>
              Could not load people. Type @ again to retry.
            </p>
          ) : shown.length === 0 ? (
            <p className='px-2 py-1.5 text-xs text-muted-foreground'>
              No one in this workspace matches “{query.query}”.
            </p>
          ) : (
            <ul id={listID} role='listbox' aria-label='People to mention'>
              {shown.map((person) => {
                const isActive = person.userId === active?.userId
                return (
                  <li
                    key={person.userId}
                    id={optionID(person)}
                    role='option'
                    aria-selected={isActive}
                    aria-disabled={!person.canRead}
                    className={cn(
                      'flex items-baseline gap-2 px-2 py-1.5 text-xs',
                      person.canRead
                        ? 'cursor-pointer'
                        : 'cursor-not-allowed text-muted-foreground',
                      isActive && 'bg-muted'
                    )}
                    onClick={() => choose(person)}
                  >
                    <span className='truncate font-medium'>{person.name}</span>
                    <span className='truncate font-mono text-[11px] text-muted-foreground'>
                      {person.email}
                    </span>
                    {!person.canRead && (
                      <span className='ml-auto shrink-0 rounded-[2px] bg-border px-1 font-mono text-[10.5px] text-foreground'>
                        no access
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
