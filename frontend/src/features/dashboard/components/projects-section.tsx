import { Link } from '@tanstack/react-router'
import { ArrowRight, FolderPlus } from 'lucide-react'
import { useDokudocs } from '@/features/dashboard/hooks/use-dokudocs'
import { ProjectCard } from '@/features/projects/components/project-card'

interface ProjectsSectionProps {
  onOpenCreateProject?: () => void
  onAddDocToProject?: (projectId: string) => void
}

export function ProjectsSection({ onAddDocToProject }: ProjectsSectionProps) {
  const { projectsWithDocs } = useDokudocs()

  return (
    <div className='space-y-3.5'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-base font-semibold tracking-tight text-foreground'>
            Projects
          </h2>
          <p className='text-xs text-muted-foreground'>
            Organized workspace folders and module documentation
          </p>
        </div>

        <Link
          to='/projects'
          className='flex items-center gap-1 text-xs font-medium text-primary hover:underline'
        >
          <span>View all projects</span>
          <ArrowRight className='size-3.5' />
        </Link>
      </div>

      {projectsWithDocs.length === 0 ? (
        <div className='flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 py-8 text-center'>
          <div className='mb-2 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground'>
            <FolderPlus className='size-5' />
          </div>
          <p className='text-xs text-muted-foreground'>
            No projects created in this workspace yet.
          </p>
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {projectsWithDocs.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onAddDoc={onAddDocToProject}
            />
          ))}
        </div>
      )}
    </div>
  )
}
