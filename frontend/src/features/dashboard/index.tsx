import { useState } from 'react'
import type { DocType } from '@/types/dokudocs'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { useDokudocs } from '@/features/dashboard/hooks/use-dokudocs'
import { CreateDocDialog } from '@/features/docs/components/create-doc-dialog'
import { ImportDocDialog } from '@/features/docs/components/import-doc-dialog'
import { FilterTabs } from './components/filter-tabs'
import { NewDocumentMenu } from './components/new-document-menu'
import { ProjectsSection } from './components/projects-section'
import { RecentSection } from './components/recent-section'

export function Dashboard() {
  const { activeOrg, isLoading, error, refetch } = useDokudocs()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [selectedType, setSelectedType] = useState<DocType>('markdown')
  const [selectedProject, setSelectedProject] = useState<string | null>(null)

  const handleOpenCreate = (
    type: DocType = 'markdown',
    projectId: string | null = null
  ) => {
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

          <NewDocumentMenu onCreate={(type) => handleOpenCreate(type)} />
        </div>
      </Header>

      <Main className='space-y-6 pt-4 pb-12'>
        <div className='flex flex-col gap-3 border-b border-border/40 pb-4 sm:flex-row sm:items-center sm:justify-between'>
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

        {error ? (
          <div
            role='alert'
            className='rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm'
          >
            <p>Could not load this workspace: {error.message}</p>
            <Button
              variant='outline'
              size='sm'
              className='mt-3'
              onClick={() => void refetch()}
            >
              Retry
            </Button>
          </div>
        ) : isLoading ? (
          <p role='status' className='text-sm text-muted-foreground'>
            Loading workspace documents and projects…
          </p>
        ) : (
          <>
            <RecentSection
              onOpenCreateDialog={() => handleOpenCreate('markdown')}
            />

            <ProjectsSection
              onAddDocToProject={(projectId) =>
                handleOpenCreate('markdown', projectId)
              }
            />
          </>
        )}
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
