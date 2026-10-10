import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { DocType, DocumentItem } from '@/types/dokudocs'
import { Lock, X } from 'lucide-react'
import { DOCUMENT_TYPES } from '@/lib/document-types'
import { createDocument, listDocuments } from '@/lib/domain-api'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { DocTypeBadge } from '@/features/docs/components/doc-type-badge'

const LINKABLE_TYPES = DOCUMENT_TYPES.filter(
  ({ value }) => value !== 'architecture'
)

export function useLinkableDocuments(workspaceID: string) {
  return useQuery({
    queryKey: ['architecture-linkable-documents', workspaceID],
    queryFn: ({ signal }) => listDocuments(workspaceID, {}, signal),
    enabled: Boolean(workspaceID),
    staleTime: 30_000,
  })
}

function excerpt(content: string) {
  const text = content
    .replace(/[#>*_`|[\]()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 280 ? `${text.slice(0, 280)}…` : text
}

/**
 * The documents a System or Connection points at. They are references: removing
 * one here, or the element, never removes the document.
 */
export function DocumentLinks({
  workspaceID,
  projectID,
  links,
  canEdit,
  onChange,
}: {
  workspaceID: string
  projectID: string | null
  links: string[]
  canEdit: boolean
  onChange: (links: string[]) => void
}) {
  const documents = useLinkableDocuments(workspaceID)
  const byID = useMemo(
    () => new Map((documents.data ?? []).map((d) => [d.id, d])),
    [documents.data]
  )
  const [previewID, setPreviewID] = useState<string | null>(null)
  const preview = previewID ? byID.get(previewID) : undefined

  return (
    <section
      className='flex flex-col gap-1.5'
      aria-labelledby='architecture-links-heading'
    >
      <h3
        id='architecture-links-heading'
        className='font-mono text-[11px] text-muted-foreground'
      >
        documents · <span className='tabular-nums'>{links.length}</span>
      </h3>
      {documents.isPending && links.length > 0 && (
        <p className='text-xs text-muted-foreground'>
          Loading linked documents…
        </p>
      )}
      {documents.isError && (
        <p className='text-xs'>
          Linked documents could not be loaded.{' '}
          <button
            type='button'
            className='underline'
            onClick={() => void documents.refetch()}
          >
            Try again
          </button>
        </p>
      )}
      {!links.length && (
        <p className='text-xs text-muted-foreground'>
          No documents yet. Link one that exists or start a new one.
        </p>
      )}
      <ul className='flex flex-col'>
        {links.map((id) => {
          const document = byID.get(id)
          const locked = !document && documents.isSuccess
          return (
            <li
              key={id}
              className='flex min-h-8 items-center gap-2 border-t border-border py-1 text-[12.5px] last:border-b'
            >
              {locked ? (
                <>
                  <Lock
                    className='size-3.5 shrink-0 text-muted-foreground'
                    strokeWidth={1.5}
                    aria-hidden
                  />
                  <span className='flex-1 truncate text-muted-foreground italic'>
                    A document you cannot open
                  </span>
                </>
              ) : document ? (
                <>
                  <DocTypeBadge type={document.type} />
                  <button
                    type='button'
                    className='flex-1 truncate text-left hover:underline focus-visible:outline-2 focus-visible:outline-signal'
                    aria-pressed={previewID === id}
                    onClick={() => setPreviewID(previewID === id ? null : id)}
                  >
                    {document.title}
                  </button>
                  <Link
                    to='/docs/$docId'
                    params={{ docId: id }}
                    className='text-xs text-signal hover:underline'
                  >
                    Open
                  </Link>
                </>
              ) : (
                <span className='flex-1 truncate text-muted-foreground'>
                  Loading…
                </span>
              )}
              {canEdit && (
                <button
                  type='button'
                  className='grid size-7 place-items-center rounded-[4px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-signal'
                  aria-label={`Unlink ${document?.title ?? 'this document'} (the document stays)`}
                  title='Unlink (the document stays)'
                  onClick={() => onChange(links.filter((l) => l !== id))}
                >
                  <X className='size-3.5' aria-hidden />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {preview && (
        <div
          className='rounded-[6px] border border-border bg-muted/40 p-2 text-xs'
          aria-label={`Preview of ${preview.title}`}
        >
          <p className='mb-1 font-medium'>{preview.title}</p>
          <p className='text-muted-foreground'>
            {excerpt(preview.content) || 'This document is empty.'}
          </p>
        </div>
      )}
      {canEdit && (
        <div className='flex flex-wrap gap-1.5'>
          <LinkExisting
            documents={documents.data ?? []}
            links={links}
            onPick={(id) => onChange([...links, id])}
          />
          <CreateAndLink
            workspaceID={workspaceID}
            projectID={projectID}
            onCreated={(document) => onChange([...links, document.id])}
          />
        </div>
      )}
    </section>
  )
}

function LinkExisting({
  documents,
  links,
  onPick,
}: {
  documents: DocumentItem[]
  links: string[]
  onPick: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const choices = documents.filter(
    (d) =>
      LINKABLE_TYPES.some(({ value }) => value === d.type) &&
      !links.includes(d.id)
  )
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size='sm' variant='outline'>
          Link a document…
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-72 p-0' align='start'>
        <Command>
          <CommandInput placeholder='Search documents' />
          <CommandList>
            <CommandEmpty>
              No Markdown, DBML or Mermaid document matches.
            </CommandEmpty>
            <CommandGroup>
              {choices.map((d) => (
                <CommandItem
                  key={d.id}
                  value={`${d.title} ${d.id}`}
                  onSelect={() => {
                    onPick(d.id)
                    setOpen(false)
                  }}
                >
                  <DocTypeBadge type={d.type} />
                  <span className='truncate'>{d.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function CreateAndLink({
  workspaceID,
  projectID,
  onCreated,
}: {
  workspaceID: string
  projectID: string | null
  onCreated: (document: DocumentItem) => void
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<Exclude<DocType, 'architecture'>>('markdown')
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: () =>
      createDocument(
        workspaceID,
        type === 'markdown'
          ? {
              title: title.trim(),
              type: 'markdown',
              content: '',
              projectId: projectID,
              isDraft: !projectID,
            }
          : {
              title: title.trim(),
              type,
              content: '',
              projectId: projectID,
              isDraft: !projectID,
            },
        crypto.randomUUID()
      ),
    onSuccess: async (document) => {
      onCreated(document)
      setOpen(false)
      setTitle('')
      await queryClient.invalidateQueries({
        queryKey: ['architecture-linkable-documents', workspaceID],
      })
    },
  })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size='sm' variant='outline'>
          New document…
        </Button>
      </PopoverTrigger>
      <PopoverContent className='flex w-72 flex-col gap-2' align='start'>
        <form
          className='flex flex-col gap-2'
          onSubmit={(event) => {
            event.preventDefault()
            if (title.trim()) create.mutate()
          }}
        >
          <label
            htmlFor='architecture-new-doc-title'
            className='font-mono text-[11px] text-muted-foreground'
          >
            title
          </label>
          <Input
            id='architecture-new-doc-title'
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className='h-8 text-[12.5px]'
            autoFocus
          />
          <label
            htmlFor='architecture-new-doc-type'
            className='font-mono text-[11px] text-muted-foreground'
          >
            type
          </label>
          <select
            id='architecture-new-doc-type'
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            className='h-8 rounded-[4px] border border-input bg-card px-2 text-[12.5px] focus-visible:outline-2 focus-visible:outline-signal'
          >
            {LINKABLE_TYPES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <p className='text-xs text-muted-foreground'>
            It is created in this document’s project and linked here.
          </p>
          {create.error && (
            <p className='text-xs text-destructive'>
              {create.error.message}. Try again.
            </p>
          )}
          <Button
            type='submit'
            size='sm'
            disabled={create.isPending || !title.trim()}
          >
            {create.isPending ? 'Creating…' : 'Create and link'}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
