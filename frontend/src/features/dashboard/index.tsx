import { useState } from 'react'
import {
  ChevronDown,
  Database,
  FileText,
  GitFork,
  Plus,
  Upload,
} from 'lucide-react'
import { DocType } from '@/types/dokudocs'
import { useDokudocs } from '@/features/dashboard/hooks/use-dokudocs'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { CreateDocDialog } from '@/features/docs/components/create-doc-dialog'
import { ImportDocDialog } from '@/features/docs/components/import-doc-dialog'
import { FilterTabs } from './components/filter-tabs'
import { ProjectsSection } from './components/projects-section'
import { RecentSection } from './components/recent-section'

export function Dashboard() {
  const { activeOrg } = useDokudocs()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [selectedType, setSelectedType] = useState<DocType>('markdown')
  const [selectedProject, setSelectedProject] = useState<string | null>(null)

  const handleOpenCreate = (type: DocType = 'markdown', projectId: string | null = null) => {
    setSelectedType(type)
    setSelectedProject(projectId)
    setCreateDialogOpen(true)
  }

  return (
    <>
      <Header fixed>
        <div className='ml-auto flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setImportDialogOpen(true)}
            className='h-8 gap-1.5 px-3 text-xs font-semibold'
          >
            <Upload className='size-3.5' />
            <span>Import</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size='sm' className='h-8 gap-1.5 px-3 text-xs font-semibold shadow-xs'>
                <Plus className='size-3.5' />
                <span>New</span>
                <ChevronDown className='size-3 opacity-60' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-48'>
              <DropdownMenuItem onClick={() => handleOpenCreate('markdown')}>
                <FileText className='mr-2 size-3.5 text-blue-500' />
                FSD / Markdown
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleOpenCreate('dbdiagram')}>
                <Database className='mr-2 size-3.5 text-emerald-500' />
                DB Diagram
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleOpenCreate('mermaid')}>
                <GitFork className='mr-2 size-3.5 text-purple-500' />
                Flowchart / Diagram
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Header>

      <Main className='space-y-6 pb-12 pt-4'>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/40 pb-4'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight text-foreground'>
              {activeOrg?.name || 'Dokudocs Workspace'}
            </h1>
            <p className='text-xs text-muted-foreground'>
              System documentation, database schemas, and architecture diagrams
            </p>
          </div>
          <FilterTabs />
        </div>

        <RecentSection onOpenCreateDialog={() => handleOpenCreate('markdown')} />

        <ProjectsSection
          onAddDocToProject={(projectId) => handleOpenCreate('markdown', projectId)}
        />
      </Main>

      <CreateDocDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        defaultType={selectedType}
        defaultProjectId={selectedProject}
      />

      <ImportDocDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
      />
    </>
  )
}
