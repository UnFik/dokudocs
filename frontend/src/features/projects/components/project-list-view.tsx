import { useState } from 'react'
import { FolderPlus, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { useDokudocs } from '@/features/dashboard/hooks/use-dokudocs'
import { CreateDocDialog } from '@/features/docs/components/create-doc-dialog'
import { CreateProjectDialog } from './create-project-dialog'
import { ProjectCard } from './project-card'

export function ProjectListView() {
  const { projectsWithDocs } = useDokudocs()
  const [searchQuery, setSearchQuery] = useState('')
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [createDocOpen, setCreateDocOpen] = useState(false)
  const [targetProjectId, setTargetProjectId] = useState<string | null>(null)

  const filteredProjects = projectsWithDocs.filter((p) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      p.name.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q)
    )
  })

  const handleAddDocToProject = (projectId: string) => {
    setTargetProjectId(projectId)
    setCreateDocOpen(true)
  }

  return (
    <>
      <Header fixed>
        <div className='flex items-center gap-2 text-sm font-semibold'>
          <span>Projects</span>
        </div>
        <div className='ml-auto flex items-center gap-2.5'>
          <Button
            size='sm'
            onClick={() => setCreateProjectOpen(true)}
            className='h-8 gap-1.5 px-3 text-xs font-semibold'
          >
            <Plus className='size-3.5' />
            <span>New Project</span>
          </Button>
        </div>
      </Header>

      <Main className='space-y-6 pt-4 pb-12'>
        <div className='flex flex-col gap-3 border-b border-border/40 pb-4 sm:flex-row sm:items-center sm:justify-between'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight text-foreground'>
              All Projects
            </h1>
            <p className='text-xs text-muted-foreground'>
              Manage architectural domains, systems, and microservices
            </p>
          </div>

          <div className='relative w-full max-w-xs'>
            <Search className='absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground' />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder='Search projects...'
              className='h-8 pl-8 text-xs'
            />
          </div>
        </div>

        {filteredProjects.length === 0 ? (
          <div className='flex min-h-[40vh] flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-card/50 p-12 text-center'>
            <div className='flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-2xs'>
              <FolderPlus className='size-6' />
            </div>
            <h3 className='mt-4 text-base font-semibold text-foreground'>
              No projects found
            </h3>
            <p className='mt-1 text-xs text-muted-foreground'>
              Create your first project to start organizing documentation.
            </p>
            <Button
              size='sm'
              className='mt-5 gap-1.5 text-xs'
              onClick={() => setCreateProjectOpen(true)}
            >
              <Plus className='size-3.5' />
              <span>Create Project</span>
            </Button>
          </div>
        ) : (
          <div className='grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3'>
            {filteredProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onAddDoc={handleAddDocToProject}
              />
            ))}
          </div>
        )}
      </Main>

      <CreateProjectDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
      />

      <CreateDocDialog
        open={createDocOpen}
        onOpenChange={setCreateDocOpen}
        defaultProjectId={targetProjectId}
      />
    </>
  )
}
