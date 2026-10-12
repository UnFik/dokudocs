import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { DocType } from '@/types/dokudocs'
import {
  Clock,
  FileEdit,
  Folder,
  FolderPlus,
  Laptop,
  Moon,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  DOCUMENT_TYPES,
  DOCUMENT_IMPORT_EXTENSIONS,
  getDocumentType,
} from '@/lib/document-types'
import { listProjects } from '@/lib/domain-api'
import { useSearch } from '@/context/search-provider'
import { useTheme } from '@/context/theme-provider'
import { useDocumentSearch } from '@/hooks/use-document-search'
import { Button } from '@/components/ui/button'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { CreateDocDialog } from '@/features/docs/components/create-doc-dialog'
import { DocTypeBadge } from '@/features/docs/components/doc-type-badge'
import { ImportDocDialog } from '@/features/docs/components/import-doc-dialog'
import { CreateProjectDialog } from '@/features/projects/components/create-project-dialog'
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces'
import { ScrollArea } from './ui/scroll-area'

const MATCH_START = '\u0001'
const MATCH_END = '\u0002'

// The server marks matched words with control characters; they become bold
// text, never HTML.
function snippetParts(snippet: string) {
  return snippet
    .split(MATCH_START)
    .flatMap((chunk, index) => {
      if (index === 0) return [{ text: chunk, match: false }]
      const [matched, ...rest] = chunk.split(MATCH_END)
      return [
        { text: matched, match: true },
        { text: rest.join(MATCH_END), match: false },
      ]
    })
    .filter((part) => part.text)
}

// Mounted only while the dialog is open, so everything below loads on demand.
function DocumentAndProjectGroups({
  search,
  runCommand,
}: {
  search: string
  runCommand: (command: () => unknown) => void
}) {
  const navigate = useNavigate()
  const { activeWorkspaceId } = useWorkspaces()
  const { data: projects = [] } = useQuery({
    queryKey: ['projects', activeWorkspaceId],
    queryFn: ({ signal }) => listProjects(activeWorkspaceId, signal),
    enabled: Boolean(activeWorkspaceId),
  })
  const { hits, isLoading, isFetching, isError, retry } = useDocumentSearch(
    search,
    true
  )

  return (
    <>
      {!hits.length && !isLoading && !isError && (
        <CommandEmpty>No matching documents or projects found.</CommandEmpty>
      )}

      {isError && (
        <div className='flex items-center justify-between gap-2 px-2 py-3 text-xs'>
          <p role='alert' className='text-destructive'>
            Search failed. Check your connection and try again.
          </p>
          <Button type='button' variant='outline' size='sm' onClick={retry}>
            Try again
          </Button>
        </div>
      )}

      {hits.length > 0 && (
        <CommandGroup
          forceMount
          heading={search.trim() ? 'Documents' : 'Recent documents'}
        >
          {hits.map((hit) => {
            const Icon = getDocumentType(hit.type).icon
            return (
              <CommandItem
                key={hit.id}
                forceMount
                value={`doc-${hit.id}`}
                onSelect={() =>
                  runCommand(() =>
                    navigate({
                      to: '/docs/$docId',
                      params: { docId: hit.id },
                    })
                  )
                }
                className='flex items-center justify-between gap-3 py-2'
              >
                <div className='flex min-w-0 flex-1 items-center gap-2.5'>
                  <div className='flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-foreground'>
                    <Icon className='size-3.5 text-muted-foreground' />
                  </div>
                  <div className='flex min-w-0 flex-col'>
                    <span className='truncate text-xs font-semibold text-foreground'>
                      {hit.title}
                    </span>
                    <span className='truncate text-[10px] text-muted-foreground'>
                      {hit.matchedOn === 'body' && hit.snippet
                        ? snippetParts(hit.snippet).map((part, index) =>
                            part.match ? (
                              <strong
                                key={index}
                                className='font-semibold text-foreground'
                              >
                                {part.text}
                              </strong>
                            ) : (
                              <span key={index}>{part.text}</span>
                            )
                          )
                        : hit.projectName || 'Personal Draft'}
                    </span>
                  </div>
                </div>
                <DocTypeBadge type={hit.type} />
              </CommandItem>
            )
          })}
        </CommandGroup>
      )}

      {isFetching && !isLoading && (
        <p role='status' className='px-2 py-2 text-xs text-muted-foreground'>
          Searching…
        </p>
      )}

      {projects.length > 0 && (
        <>
          <CommandSeparator />
          <CommandGroup heading='Projects'>
            {projects.map((proj) => (
              <CommandItem
                key={proj.id}
                value={`proj-${proj.id}-${proj.name}-${proj.description || ''}`}
                onSelect={() =>
                  runCommand(() =>
                    navigate({
                      to: '/projects/$projectId',
                      params: { projectId: proj.id },
                    })
                  )
                }
                className='flex items-center justify-between py-2'
              >
                <div className='flex min-w-0 flex-1 items-center gap-2.5'>
                  {proj.logoUrl ? (
                    <img
                      src={proj.logoUrl}
                      alt={proj.name}
                      className='size-6 shrink-0 rounded-md border border-border object-cover'
                    />
                  ) : (
                    <div className='flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground'>
                      <Folder className='size-3.5' />
                    </div>
                  )}
                  <div className='flex min-w-0 flex-col truncate'>
                    <span className='truncate text-xs font-semibold text-foreground'>
                      {proj.name}
                    </span>
                    {proj.description && (
                      <span className='truncate text-[10px] text-muted-foreground'>
                        {proj.description}
                      </span>
                    )}
                  </div>
                </div>
                <span className='shrink-0 font-mono text-[10px] text-muted-foreground'>
                  {proj.documentIds.length} docs
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </>
      )}
    </>
  )
}

export function CommandMenu() {
  const navigate = useNavigate()
  const { setTheme } = useTheme()
  const { open, setOpen } = useSearch()

  const [search, setSearch] = useState('')
  const [createDocOpen, setCreateDocOpen] = useState(false)
  const [importDocOpen, setImportDocOpen] = useState(false)
  const [createDocType, setCreateDocType] = useState<DocType>('markdown')
  const [createProjectOpen, setCreateProjectOpen] = useState(false)

  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (!open) setSearch('')
  }

  const runCommand = React.useCallback(
    (command: () => unknown) => {
      setOpen(false)
      command()
    },
    [setOpen]
  )

  const handleCreateDocAction = (type: DocType) => {
    setOpen(false)
    setCreateDocType(type)
    setCreateDocOpen(true)
  }

  const handleCreateProjectAction = () => {
    setOpen(false)
    setCreateProjectOpen(true)
  }

  return (
    <>
      <CommandDialog
        modal
        open={open}
        onOpenChange={setOpen}
        className='sm:max-w-2xl'
      >
        <CommandInput
          value={search}
          onValueChange={setSearch}
          placeholder='Search documents, projects, commands (⌘K)...'
        />
        <CommandList>
          <ScrollArea type='hover' className='h-[28rem] max-h-[60svh] pe-1'>
            <DocumentAndProjectGroups search={search} runCommand={runCommand} />

            <CommandSeparator />
            <CommandGroup heading='Quick Create'>
              {DOCUMENT_TYPES.map(({ value, label, keywords, icon: Icon }) => (
                <CommandItem
                  key={`action-create-${value}`}
                  value={`action-create-${value}-${label}-${keywords}`}
                  onSelect={() => handleCreateDocAction(value)}
                >
                  <div className='flex size-5 items-center justify-center rounded-sm bg-secondary text-muted-foreground'>
                    <Icon className='size-3' />
                  </div>
                  <span>New {label} Document</span>
                </CommandItem>
              ))}
              <CommandItem
                key='action-import-document'
                value={`action-import-document-${DOCUMENT_TYPES.map(({ label }) => label).join('-')}`}
                onSelect={() => {
                  setOpen(false)
                  setImportDocOpen(true)
                }}
              >
                <div className='flex size-5 items-center justify-center rounded-sm bg-primary/10 text-primary'>
                  <Upload className='size-3' />
                </div>
                <span>
                  Import Document (
                  {DOCUMENT_IMPORT_EXTENSIONS.replaceAll(',', ', ')})
                </span>
              </CommandItem>
              <CommandItem
                key='action-create-project'
                value='action-create-new-project-workspace'
                onSelect={handleCreateProjectAction}
              >
                <div className='flex size-5 items-center justify-center rounded-sm bg-primary/10 text-primary'>
                  <FolderPlus className='size-3' />
                </div>
                <span>New Project Workspace</span>
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />
            <CommandGroup heading='Navigation'>
              <CommandItem
                key='nav-goto-recent'
                value='nav-goto-recent-documents'
                onSelect={() =>
                  runCommand(() => navigate({ to: '/dashboard' }))
                }
              >
                <Clock className='size-3.5 text-muted-foreground' />
                <span>Recent Documents</span>
              </CommandItem>
              <CommandItem
                key='nav-goto-drafts'
                value='nav-goto-my-drafts-scratchpads'
                onSelect={() => runCommand(() => navigate({ to: '/drafts' }))}
              >
                <FileEdit className='size-3.5 text-muted-foreground' />
                <span>My Drafts</span>
              </CommandItem>
              <CommandItem
                key='nav-goto-projects'
                value='nav-goto-all-projects-workspaces'
                onSelect={() => runCommand(() => navigate({ to: '/projects' }))}
              >
                <Folder className='size-3.5 text-muted-foreground' />
                <span>Projects</span>
              </CommandItem>
              <CommandItem
                key='nav-goto-trash'
                value='nav-goto-trash-bin-deleted'
                onSelect={() => runCommand(() => navigate({ to: '/trash' }))}
              >
                <Trash2 className='size-3.5 text-muted-foreground' />
                <span>Trash</span>
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />
            <CommandGroup heading='Theme'>
              <CommandItem
                key='theme-select-light'
                value='theme-select-light-theme-mode'
                onSelect={() => runCommand(() => setTheme('light'))}
              >
                <Sun className='size-3.5' /> <span>Light Theme</span>
              </CommandItem>
              <CommandItem
                key='theme-select-dark'
                value='theme-select-dark-theme-mode'
                onSelect={() => runCommand(() => setTheme('dark'))}
              >
                <Moon className='size-3.5' /> <span>Dark Theme</span>
              </CommandItem>
              <CommandItem
                key='theme-select-system'
                value='theme-select-system-default-mode'
                onSelect={() => runCommand(() => setTheme('system'))}
              >
                <Laptop className='size-3.5' /> <span>System Default</span>
              </CommandItem>
            </CommandGroup>
          </ScrollArea>
        </CommandList>
      </CommandDialog>

      {createDocOpen && (
        <CreateDocDialog
          open
          onOpenChange={setCreateDocOpen}
          defaultType={createDocType}
        />
      )}

      {importDocOpen && (
        <ImportDocDialog open onOpenChange={setImportDocOpen} />
      )}

      {createProjectOpen && (
        <CreateProjectDialog open onOpenChange={setCreateProjectOpen} />
      )}
    </>
  )
}
