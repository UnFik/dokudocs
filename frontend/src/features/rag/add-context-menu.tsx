import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import type { RAGCategory, Skill } from '@/lib/domain-api'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { FILE_ACCEPT } from './question-extras'

export type ContextChat = { id: string; title: string }

const row =
  'block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none aria-disabled:pointer-events-none aria-disabled:text-muted-foreground max-sm:min-h-11'
const heading = 'px-3 pt-2 pb-1 font-mono text-[11px] text-muted-foreground'

/**
 * The plus under the question box: a searchable list that opens upward, since
 * the box sits at the bottom of the panel. It adds a text file, another chat,
 * a category or a skill to the question being written.
 */
export function AddContextMenu({
  skills,
  chats,
  categories,
  scope,
  disabled,
  chatsFull,
  categoriesFull,
  filesFull,
  onPickSkill,
  onPickChat,
  onPickCategory,
  onFiles,
}: {
  skills: Skill[]
  /** Chats the User can bring in, without the ones already chosen or the one open. */
  chats: ContextChat[]
  categories: RAGCategory[]
  /** Category narrows a search across the workspace, so a document chat has none. */
  scope: 'document' | 'workspace'
  disabled?: boolean
  chatsFull: boolean
  categoriesFull: boolean
  filesFull: boolean
  onPickSkill: (name: string) => void
  onPickChat: (chat: ContextChat) => void
  onPickCategory: (category: RAGCategory) => void
  onFiles: (files: File[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const needle = query.trim().toLowerCase()
  const matches = (text: string) => text.toLowerCase().includes(needle)
  const shownChats = chats.filter((chat) =>
    matches(chat.title || 'Untitled chat')
  )
  const shownCategories =
    scope === 'workspace'
      ? categories.filter(
          (category) => matches(category.name) || matches(category.projectName)
        )
      : []
  const shownSkills = skills.filter((skill) => matches(skill.name))
  const showFile = matches('file') || matches('attach') || matches('upload')
  const nothing =
    Boolean(needle) &&
    !showFile &&
    shownChats.length === 0 &&
    shownCategories.length === 0 &&
    shownSkills.length === 0
  const close = () => {
    setOpen(false)
    setQuery('')
  }
  return (
    <>
      <input
        ref={picker}
        type='file'
        multiple
        accept={FILE_ACCEPT}
        aria-label='Attach a text file'
        tabIndex={-1}
        className='sr-only'
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (files.length > 0) onFiles(files)
        }}
      />
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
            {showFile ? (
              <>
                <p className={heading}>File</p>
                <button
                  type='button'
                  role='option'
                  aria-selected='false'
                  aria-disabled={filesFull}
                  onClick={() => {
                    if (filesFull) return
                    close()
                    picker.current?.click()
                  }}
                  className={row}
                >
                  Attach a text file
                  <span className='block text-xs text-muted-foreground'>
                    .txt, .md, .csv, .json, up to 5 for one question
                  </span>
                </button>
              </>
            ) : null}
            {shownChats.length > 0 ? (
              <>
                <p className={heading}>Chat</p>
                {shownChats.map((chat) => (
                  <button
                    key={chat.id}
                    type='button'
                    role='option'
                    aria-selected='false'
                    aria-disabled={chatsFull}
                    onClick={() => {
                      if (chatsFull) return
                      onPickChat(chat)
                      close()
                    }}
                    className={row}
                  >
                    <span className='block truncate'>
                      {chat.title || 'Untitled chat'}
                    </span>
                  </button>
                ))}
              </>
            ) : null}
            {shownCategories.length > 0 ? (
              <>
                <p className={heading}>Category</p>
                {shownCategories.map((category) => (
                  <button
                    key={category.id}
                    type='button'
                    role='option'
                    aria-selected='false'
                    aria-disabled={categoriesFull}
                    onClick={() => {
                      if (categoriesFull) return
                      onPickCategory(category)
                      close()
                    }}
                    className={row}
                  >
                    <span className='block truncate'>{category.name}</span>
                    <span className='block truncate text-xs text-muted-foreground'>
                      {category.projectName}
                    </span>
                  </button>
                ))}
              </>
            ) : null}
            {shownSkills.length > 0 || !needle ? (
              <p className={heading}>Skills</p>
            ) : null}
            {shownSkills.map((skill) => (
              <button
                key={skill.id}
                type='button'
                role='option'
                aria-selected='false'
                onClick={() => {
                  onPickSkill(skill.name)
                  close()
                }}
                className={row}
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
            {nothing ? (
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
    </>
  )
}
