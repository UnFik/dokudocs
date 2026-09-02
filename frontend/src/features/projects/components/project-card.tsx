import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ProjectWithDocuments } from '@/types/dokudocs'
import {
  Folder,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { formatRelativeTime } from '@/lib/time-utils'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DeleteProjectDialog } from './delete-project-dialog'
import { EditProjectDialog } from './edit-project-dialog'
import { ProjectSubCard } from './project-sub-card'

interface ProjectCardProps {
  project: ProjectWithDocuments
  onAddDoc?: (projectId: string) => void
}

export function ProjectCard({ project, onAddDoc }: ProjectCardProps) {
  const navigate = useNavigate()
  const toggleStarProject = useDokudocsStore((s) => s.toggleStarProject)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const docs = project.documents
  const hasMore = project.totalDocsCount > 3
  const remainingCount = project.totalDocsCount - 3

  const slot1 = docs[0]
  const slot2 = docs[1]
  const slot3 = docs[2]

  const handleToggleStar = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    toggleStarProject(project.id)
    toast.success(
      project.isStarred
        ? `Unstarred "${project.name}"`
        : `Starred "${project.name}"`
    )
  }

  const handleCardClick = () => {
    navigate({
      to: '/projects/$projectId',
      params: { projectId: project.id },
    })
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            onClick={handleCardClick}
            className='group relative flex transform-gpu cursor-pointer flex-col justify-between rounded-xl border border-border/80 bg-card p-4 transition-[transform,box-shadow,border-color] duration-150 ease-out will-change-transform select-none hover:-translate-y-0.5 hover:border-sidebar-ring/60 hover:shadow-md'
          >
            <div>
              <div className='mb-3 flex items-start justify-between'>
                <div className='flex min-w-0 items-center gap-2.5'>
                  {project.logoUrl ? (
                    <img
                      src={project.logoUrl}
                      alt={project.name}
                      className='size-9 shrink-0 rounded-lg border border-border/80 object-cover shadow-2xs'
                    />
                  ) : (
                    <div className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
                      <Folder className='size-4.5' />
                    </div>
                  )}
                  <div className='min-w-0'>
                    <h3 className='block truncate text-sm font-semibold tracking-tight text-foreground transition-colors group-hover:text-primary'>
                      {project.name}
                    </h3>
                    <p className='max-w-44 truncate text-xs text-muted-foreground'>
                      {project.description
                        ? project.description
                        : `${project.totalDocsCount} ${
                            project.totalDocsCount === 1
                              ? 'document'
                              : 'documents'
                          }`}
                    </p>
                  </div>
                </div>

                <div
                  className='flex shrink-0 items-center gap-0.5'
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    variant='ghost'
                    size='icon'
                    onClick={handleToggleStar}
                    className='size-7 text-muted-foreground transition-colors hover:text-amber-500'
                    title={
                      project.isStarred ? 'Unstar Project' : 'Star Project'
                    }
                  >
                    <Star
                      className={`size-3.5 ${
                        project.isStarred
                          ? 'fill-amber-400 text-amber-500'
                          : 'text-muted-foreground/60'
                      }`}
                    />
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant='ghost'
                        size='icon'
                        className='size-7 opacity-70 hover:opacity-100'
                      >
                        <MoreHorizontal className='size-3.5' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end' className='w-44'>
                      <DropdownMenuItem asChild>
                        <Link
                          to='/projects/$projectId'
                          params={{ projectId: project.id }}
                        >
                          <Folder className='mr-2 size-3.5' />
                          View Project
                        </Link>
                      </DropdownMenuItem>

                      <DropdownMenuItem onClick={handleToggleStar}>
                        <Star
                          className={`mr-2 size-3.5 ${
                            project.isStarred
                              ? 'fill-amber-400 text-amber-500'
                              : ''
                          }`}
                        />
                        <span>
                          {project.isStarred
                            ? 'Unstar Project'
                            : 'Star Project'}
                        </span>
                      </DropdownMenuItem>

                      <DropdownMenuItem onClick={() => setEditDialogOpen(true)}>
                        <Pencil className='mr-2 size-3.5' />
                        Edit Project
                      </DropdownMenuItem>

                      {onAddDoc && (
                        <DropdownMenuItem onClick={() => onAddDoc(project.id)}>
                          <Plus className='mr-2 size-3.5' />
                          Add Document
                        </DropdownMenuItem>
                      )}

                      <DropdownMenuSeparator />

                      <DropdownMenuItem
                        onClick={() => setDeleteDialogOpen(true)}
                        className='text-destructive focus:text-destructive'
                      >
                        <Trash2 className='mr-2 size-3.5' />
                        Delete Project
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className='mt-3 grid grid-cols-2 grid-rows-2 gap-2.5 rounded-xl border border-border/50 bg-muted/30 p-2.5'>
                {slot1 ? (
                  <div onClick={(e) => e.stopPropagation()}>
                    <ProjectSubCard document={slot1} />
                  </div>
                ) : (
                  <div className='flex h-24 items-center justify-center rounded-lg border border-dashed border-border/60 bg-background/50 text-[10px] text-muted-foreground/50'>
                    Empty
                  </div>
                )}

                {slot2 ? (
                  <div onClick={(e) => e.stopPropagation()}>
                    <ProjectSubCard document={slot2} />
                  </div>
                ) : (
                  <div className='flex h-24 items-center justify-center rounded-lg border border-dashed border-border/60 bg-background/50 text-[10px] text-muted-foreground/50'>
                    Empty
                  </div>
                )}

                {slot3 ? (
                  <div onClick={(e) => e.stopPropagation()}>
                    <ProjectSubCard document={slot3} />
                  </div>
                ) : (
                  <div className='flex h-24 items-center justify-center rounded-lg border border-dashed border-border/60 bg-background/50 text-[10px] text-muted-foreground/50'>
                    Empty
                  </div>
                )}

                {hasMore ? (
                  <Link
                    to='/projects/$projectId'
                    params={{ projectId: project.id }}
                    onClick={(e) => e.stopPropagation()}
                    className='flex h-24 flex-col items-center justify-center rounded-lg border border-border/60 bg-background/70 text-center transition-[background-color,border-color] duration-150 hover:border-primary/50 hover:bg-primary/5'
                  >
                    <Layers className='mb-1 size-4 text-muted-foreground' />
                    <span className='text-xs font-semibold text-foreground'>
                      +{remainingCount} more
                    </span>
                    <span className='text-[10px] text-muted-foreground'>
                      View all
                    </span>
                  </Link>
                ) : (
                  <div className='flex h-24 items-center justify-center rounded-lg border border-dashed border-border/60 bg-background/50 text-[10px] text-muted-foreground/50'>
                    Empty
                  </div>
                )}
              </div>
            </div>

            <div className='mt-4 flex items-center justify-between border-t border-border/50 pt-3 text-[11px] text-muted-foreground'>
              <span className='font-medium text-foreground/80'>
                {project.totalDocsCount} documents
              </span>
              <span>Updated {formatRelativeTime(project.updatedAt)}</span>
            </div>
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent className='w-48'>
          <ContextMenuItem asChild>
            <Link to='/projects/$projectId' params={{ projectId: project.id }}>
              <Folder className='mr-2 size-3.5 text-primary' />
              Open Project
            </Link>
          </ContextMenuItem>

          <ContextMenuItem onClick={handleToggleStar}>
            <Star
              className={`mr-2 size-3.5 ${
                project.isStarred ? 'fill-amber-400 text-amber-500' : ''
              }`}
            />
            <span>{project.isStarred ? 'Unstar Project' : 'Star Project'}</span>
          </ContextMenuItem>

          <ContextMenuItem onClick={() => setEditDialogOpen(true)}>
            <Pencil className='mr-2 size-3.5' />
            Edit Project
          </ContextMenuItem>

          {onAddDoc && (
            <ContextMenuItem onClick={() => onAddDoc(project.id)}>
              <Plus className='mr-2 size-3.5' />
              Add Document
            </ContextMenuItem>
          )}

          <ContextMenuSeparator />

          <ContextMenuItem
            onClick={() => setDeleteDialogOpen(true)}
            className='text-destructive focus:text-destructive'
          >
            <Trash2 className='mr-2 size-3.5' />
            Delete Project
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <EditProjectDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        project={project}
      />

      <DeleteProjectDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        project={project}
      />
    </>
  )
}
