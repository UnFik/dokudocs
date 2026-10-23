import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { DocumentItem } from '@/types/dokudocs'
import { Lock, X } from 'lucide-react'
import { DOCUMENT_TYPES, type CreatableDocType } from '@/lib/document-types'
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
import { DocumentCard } from '@/features/rag/markdown/document-references'

export function useLinkableDocuments(workspaceID: string) {
  return useQuery({
    queryKey: ['architecture-linkable-documents', workspaceID],
    queryFn: ({ signal }) => listDocuments(workspaceID, {}, signal),
    enabled: Boolean(workspaceID),
    staleTime: 30_000,
  })
}

/**
 * The documents a System or Connection points at, another Architecture among
 * them. They are references: removing one here, or the element, never removes
 * the document. The canvas itself is never offered.
 */
export function DocumentLinks({
  workspaceID,
  projectID,
  architectureID,
  links,
  canEdit,
  onChange,
}: {
  workspaceID: string
  projectID: string | null
  architectureID: string
  links: string[]
  canEdit: boolean
  onChange: (links: string[]) => void
}) {
  const documents = useLinkableDocuments(workspaceID)
  const byID = useMemo(
    () => new Map((documents.data ?? []).map((d) => [d.id, d])),
    [documents.data]
  )

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
      {canEdit && (
        <div className='flex flex-wrap gap-1.5'>
          <LinkExisting
            documents={documents.data ?? []}
            links={links}
            architectureID={architectureID}
            onPick={(id) => onChange([...links, id])}
          />
          <CreateAndLink
            workspaceID={workspaceID}
            projectID={projectID}
            onCreated={(document) => onChange([...links, document.id])}
          />
        </div>
      )}
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
              className='flex min-h-8 items-center gap-2 border-t border-border px-1 py-1 text-[12.5px] transition-colors last:border-b hover:bg-accent hover:text-accent-foreground'
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
                  <DocumentCard
                    hit={{
                      id,
                      title: document.title,
                      projectName: document.projectName ?? '',
                      type: document.type,
                    }}
                    workspaceID={workspaceID}
                  >
                    <Link
                      to='/docs/$docId'
                      params={{ docId: id }}
                      className='flex-1 truncate text-left hover:underline focus-visible:outline-2 focus-visible:outline-signal'
                    >
                      {document.title}
                    </Link>
                  </DocumentCard>
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
    </section>
  )
}

function LinkExisting({
  documents,
  links,
  architectureID,
  onPick,
}: {
  documents: DocumentItem[]
  links: string[]
  architectureID: string
  onPick: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const choices = documents.filter(
    (d) =>
      DOCUMENT_TYPES.some(({ value }) => value === d.type) &&
      d.id !== architectureID &&
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
              No Markdown, DBML, Mermaid or Architecture document matches.
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
  const [type, setType] = useState<CreatableDocType>('markdown')
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
          : type === 'architecture'
            ? {
                // The API starts an empty canvas.
                title: title.trim(),
                type: 'architecture',
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
            {DOCUMENT_TYPES.map(({ value, label }) => (
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
