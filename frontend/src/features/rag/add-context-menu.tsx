import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { Skill } from '@/lib/domain-api'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

// TODO: File, Chat and Category need server support (attachments, a chat as
// context, a category filter on search). They are listed with "Soon" so the
// menu shows where it is going, and none of them is a live control yet.
const comingSoon = ['File', 'Chat', 'Category'] as const

/**
 * The plus under the question box: a searchable list that opens upward, since
 * the box sits at the bottom of the panel. Skills work today.
 */
export function AddContextMenu({
  skills,
  scope,
  disabled,
  onPickSkill,
}: {
  skills: Skill[]
  /** Category narrows a search across the workspace, so a document chat has none. */
  scope: 'document' | 'workspace'
  disabled?: boolean
  onPickSkill: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const matches = (text: string) => text.toLowerCase().includes(needle)
  const soon = comingSoon.filter(
    (name) => (name !== 'Category' || scope === 'workspace') && matches(name)
  )
  const found = skills.filter((skill) => matches(skill.name))
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          aria-label='Add context'
          disabled={disabled}
          className='size-8 max-sm:size-11'
        >
          <Plus />
        </Button>
      </PopoverTrigger>
      <PopoverContent side='top' align='start' className='w-72 p-0'>
        <div className='border-b p-2'>
          <input
            type='search'
            aria-label='Search context'
            placeholder='Search'
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className='h-9 w-full rounded-sm border border-input bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
          />
        </div>
        <div
          role='listbox'
          aria-label='Context'
          className='max-h-64 overflow-y-auto py-1'
        >
          {soon.map((name) => (
            <div
              key={name}
              role='option'
              aria-selected='false'
              aria-disabled='true'
              className='flex items-center justify-between px-3 py-2 text-sm text-muted-foreground'
            >
              <span>{name}</span>
              <span className='font-mono text-[11px]'>Soon</span>
            </div>
          ))}
          {found.length > 0 || !needle ? (
            <p className='px-3 pt-2 pb-1 font-mono text-[11px] text-muted-foreground'>
              Skills
            </p>
          ) : null}
          {found.map((skill) => (
            <button
              key={skill.id}
              type='button'
              role='option'
              aria-selected='false'
              onClick={() => {
                onPickSkill(skill.name)
                setOpen(false)
              }}
              className='block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none'
            >
              <span className='font-mono text-xs'>/{skill.name}</span>
              {skill.description ? (
                <span className='block truncate text-xs text-muted-foreground'>
                  {skill.description}
                </span>
              ) : null}
            </button>
          ))}
          {!needle && skills.length === 0 ? (
            <p className='px-3 pb-2 text-xs text-muted-foreground'>
              No skills have been written yet.
            </p>
          ) : null}
          {needle && soon.length === 0 && found.length === 0 ? (
            <p
              role='status'
              className='px-3 py-2 text-sm text-muted-foreground'
            >
              Nothing matches.
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
