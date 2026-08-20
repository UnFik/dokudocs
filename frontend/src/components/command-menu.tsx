import React, { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Clock,
  Database,
  FileEdit,
  FileText,
  Folder,
  FolderPlus,
  GitFork,
  Laptop,
  Moon,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react'
import { DocType } from '@/types/dokudocs'
import { getCategoryPalette } from '@/lib/category-palette'
import { getDocCategories } from '@/lib/doc-category-utils'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { useSearch } from '@/context/search-provider'
import { useTheme } from '@/context/theme-provider'
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
import { ImportDocDialog } from '@/features/docs/components/import-doc-dialog'
import { CreateProjectDialog } from '@/features/projects/components/create-project-dialog'
import { ScrollArea } from './ui/scroll-area'

export function CommandMenu() {
  const navigate = useNavigate()
  const { setTheme } = useTheme()
  const { open, setOpen } = useSearch()
  const { documents, projects, recordDocumentView } = useDokudocsStore()

  const [createDocOpen, setCreateDocOpen] = useState(false)
  const [importDocOpen, setImportDocOpen] = useState(false)
  const [createDocType, setCreateDocType] = useState<DocType>('markdown')
  const [createProjectOpen, setCreateProjectOpen] = useState(false)

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
      <CommandDialog modal open={open} onOpenChange={setOpen}>
        <CommandInput placeholder='Search documents, projects, commands (⌘K)...' />
        <CommandList>
          <ScrollArea type='hover' className='h-80 pe-1'>
            <CommandEmpty>No matching documents or projects found.</CommandEmpty>

            {documents.length > 0 && (
              <CommandGroup heading='Documents'>
                {documents.map((doc, idx) => {
                  const project = projects.find((p) => p.id === doc.projectId)
                  const docCats = getDocCategories(doc)

                  const uniqueValue = `doc-${doc.id}-${idx}-${doc.title}-${
                    doc.projectName || 'draft'
                  }-${docCats.join('-')}-${doc.type}`

                  return (
                    <CommandItem
                      key={`doc-item-${doc.id}-${idx}`}
                      value={uniqueValue}
                      onSelect={() => {
                        runCommand(() => {
                          recordDocumentView(doc.id)
                          navigate({
                            to: '/docs/$docId',
                            params: { docId: doc.id },
                          })
                        })
                      }}
                      className='flex items-center justify-between py-2'
                    >
                      <div className='flex items-center gap-2.5 min-w-0 flex-1'>
                        <div className='flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-foreground'>
                          {doc.type === 'markdown' && (
                            <FileText className='size-3.5 text-blue-500' />
                          )}
                          {doc.type === 'dbdiagram' && (
                            <Database className='size-3.5 text-emerald-500' />
                          )}
                          {doc.type === 'mermaid' && (
                            <GitFork className='size-3.5 text-purple-500' />
                          )}
                        </div>
                        <div className='flex flex-col min-w-0 truncate'>
                          <span className='truncate text-xs font-semibold text-foreground'>
                            {doc.title}
                          </span>
                          <span className='truncate text-[10px] text-muted-foreground'>
                            {doc.projectName ? doc.projectName : 'Personal Draft'}
                          </span>
                        </div>
                      </div>

                      <div className='flex items-center gap-1 shrink-0'>
                        {docCats.length > 0 && (() => {
                          const firstCat = docCats[0]
                          const colorId = project?.categoryColors?.[firstCat]
                          const palette = getCategoryPalette(firstCat, colorId, 0)
                          const remainingCount = docCats.length - 1

                          return (
                            <>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[9px] font-medium border ${palette.bg} ${palette.text} ${palette.border}`}
                              >
                                {firstCat}
                              </span>
                              {remainingCount > 0 && (
                                <span
                                  title={docCats.slice(1).join(', ')}
                                  className='rounded-full px-1.5 py-0.5 text-[9px] font-medium border border-border/80 bg-muted/60 text-muted-foreground'
                                >
                                  +{remainingCount}
                                </span>
                              )}
                            </>
                          )
                        })()}
                      </div>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}

            {projects.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading='Projects'>
                  {projects.map((proj, idx) => {
                    const uniqueValue = `proj-${proj.id}-${idx}-${proj.name}-${
                      proj.description || ''
                    }`

                    return (
                      <CommandItem
                        key={`proj-item-${proj.id}-${idx}`}
                        value={uniqueValue}
                        onSelect={() => {
                          runCommand(() =>
                            navigate({
                              to: '/projects/$projectId',
                              params: { projectId: proj.id },
                            })
                          )
                        }}
                        className='flex items-center justify-between py-2'
                      >
                        <div className='flex items-center gap-2.5 min-w-0 flex-1'>
                          {proj.logoUrl ? (
                            <img
                              src={proj.logoUrl}
                              alt={proj.name}
                              className='size-6 shrink-0 rounded-md object-cover border border-border shadow-2xs'
                            />
                          ) : (
                            <div className='flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary'>
                              <Folder className='size-3.5' />
                            </div>
                          )}
                          <div className='flex flex-col min-w-0 truncate'>
                            <span className='truncate text-xs font-semibold text-foreground'>
                              {proj.name}
                            </span>
                            <span className='truncate text-[10px] text-muted-foreground'>
                              {proj.description ||
                                `${proj.documentIds.length} documents`}
                            </span>
                          </div>
                        </div>
                        <span className='text-[10px] font-mono text-muted-foreground shrink-0'>
                          {proj.documentIds.length} docs
                        </span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </>
            )}

            <CommandSeparator />
            <CommandGroup heading='Quick Create'>
              <CommandItem
                key='action-create-markdown'
                value='action-create-markdown-document-fsd'
                onSelect={() => handleCreateDocAction('markdown')}
              >
                <div className='flex size-5 items-center justify-center rounded-sm bg-blue-500/10 text-blue-600 dark:text-blue-400'>
                  <FileText className='size-3' />
                </div>
                <span>New FSD / Markdown Document</span>
              </CommandItem>
              <CommandItem
                key='action-create-dbdiagram'
                value='action-create-dbdiagram-database-diagram-dbml'
                onSelect={() => handleCreateDocAction('dbdiagram')}
              >
                <div className='flex size-5 items-center justify-center rounded-sm bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'>
                  <Database className='size-3' />
                </div>
                <span>New Database Diagram (DBML)</span>
              </CommandItem>
              <CommandItem
                key='action-create-mermaid'
                value='action-create-mermaid-flowchart-diagram'
                onSelect={() => handleCreateDocAction('mermaid')}
              >
                <div className='flex size-5 items-center justify-center rounded-sm bg-purple-500/10 text-purple-600 dark:text-purple-400'>
                  <GitFork className='size-3' />
                </div>
                <span>New Flowchart Diagram (Mermaid)</span>
              </CommandItem>
              <CommandItem
                key='action-import-document'
                value='action-import-document-markdown-dbml-mermaid'
                onSelect={() => {
                  setOpen(false)
                  setImportDocOpen(true)
                }}
              >
                <div className='flex size-5 items-center justify-center rounded-sm bg-primary/10 text-primary'>
                  <Upload className='size-3' />
                </div>
                <span>Import Document (.md, .dbml, .mermaid)</span>
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
                onSelect={() => runCommand(() => navigate({ to: '/' }))}
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

      <CreateDocDialog
        open={createDocOpen}
        onOpenChange={setCreateDocOpen}
        defaultType={createDocType}
      />

      <ImportDocDialog
        open={importDocOpen}
        onOpenChange={setImportDocOpen}
      />

      <CreateProjectDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
      />
    </>
  )
}
