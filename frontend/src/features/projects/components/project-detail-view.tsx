import { useMemo, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import {
  ArrowLeft,
  Folder,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Search,
  Star,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { ViewMode } from '@/types/dokudocs'
import { getDocCategories } from '@/lib/doc-category-utils'
import { formatRelativeTime } from '@/lib/time-utils'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { useDokudocs } from '@/features/dashboard/hooks/use-dokudocs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { CreateDocDialog } from '@/features/docs/components/create-doc-dialog'
import { DocCard } from '@/features/docs/components/doc-card'
import { DocListRow } from '@/features/docs/components/doc-list-row'
import { ImportDocDialog } from '@/features/docs/components/import-doc-dialog'
import { EditProjectDialog } from './edit-project-dialog'
import { ProjectCategoryFilter } from './project-category-filter'

export function ProjectDetailView() {
  const { projectId } = useParams({ from: '/_authenticated/projects/$projectId' })
  const { projectsWithDocs } = useDokudocs()
  const toggleStarProject = useDokudocsStore((s) => s.toggleStarProject)

  const project = projectsWithDocs.find((p) => p.id === projectId)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [createDocOpen, setCreateDocOpen] = useState(false)
  const [importDocOpen, setImportDocOpen] = useState(false)
  const [editProjectOpen, setEditProjectOpen] = useState(false)

  const handleToggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    )
  }

  const handleClearCategories = () => {
    setSelectedCategories([])
  }

  const handleToggleStar = () => {
    if (!project) return
    toggleStarProject(project.id)
    toast.success(
      project.isStarred
        ? `Unstarred "${project.name}"`
        : `Starred "${project.name}"`
    )
  }

  const docCountsByCategory = useMemo(() => {
    if (!project) return {}
    const counts: Record<string, number> = {}
    const categories = project.categories ?? []

    categories.forEach((cat) => {
      counts[cat] = project.documents.filter((d) =>
        getDocCategories(d).includes(cat)
      ).length
    })

    return counts
  }, [project])

  if (!project) {
    return (
      <Main className='flex h-[70vh] flex-col items-center justify-center text-center'>
        <h2 className='text-lg font-bold'>Project Not Found</h2>
        <p className='mt-1 text-xs text-muted-foreground'>
          The requested project does not exist or was deleted.
        </p>
        <Button asChild size='sm' className='mt-4 text-xs'>
          <Link to='/projects'>Back to Projects</Link>
        </Button>
      </Main>
    )
  }

  const filteredDocs = project.documents.filter((doc) => {
    const docCats = getDocCategories(doc)
    if (
      selectedCategories.length > 0 &&
      !selectedCategories.some((cat) => docCats.includes(cat))
    ) {
      return false
    }

    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      doc.title.toLowerCase().includes(q) ||
      docCats.some((c) => c.toLowerCase().includes(q)) ||
      doc.tags?.some((t) => t.toLowerCase().includes(q))
    )
  })

  return (
    <>
      <Header fixed>
        <div className='flex items-center gap-2 text-sm'>
          <Link
            to='/projects'
            className='flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors'
          >
            <ArrowLeft className='size-3.5' />
            <span>Projects</span>
          </Link>
          <span className='text-muted-foreground/60'>/</span>
          <span className='font-semibold truncate max-w-48'>{project.name}</span>
        </div>

        <div className='ml-auto flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={handleToggleStar}
            className='h-8 gap-1.5 px-2.5 text-xs font-medium'
            title={project.isStarred ? 'Unstar Project' : 'Star Project'}
          >
            <Star
              className={`size-3.5 ${
                project.isStarred
                  ? 'fill-amber-400 text-amber-500'
                  : 'text-muted-foreground/70'
              }`}
            />
            <span className='hidden sm:inline'>
              {project.isStarred ? 'Starred' : 'Star'}
            </span>
          </Button>

          <Button
            variant='outline'
            size='sm'
            onClick={() => setImportDocOpen(true)}
            className='h-8 gap-1.5 px-3 text-xs font-semibold'
          >
            <Upload className='size-3.5' />
            <span>Import</span>
          </Button>

          <Button
            size='sm'
            onClick={() => setCreateDocOpen(true)}
            className='h-8 gap-1.5 px-3 text-xs font-semibold'
          >
            <Plus className='size-3.5' />
            <span>Add Document</span>
          </Button>
        </div>
      </Header>

      <Main className='space-y-6 pb-12 pt-4'>
        <div className='flex flex-col gap-3 border-b border-border/40 pb-5'>
          <div className='flex items-center justify-between gap-4'>
            <div className='flex items-center gap-3'>
              {project.logoUrl ? (
                <img
                  src={project.logoUrl}
                  alt={project.name}
                  className='size-11 shrink-0 rounded-xl object-cover border border-border shadow-2xs'
                />
              ) : (
                <div className='flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary'>
                  <Folder className='size-5' />
                </div>
              )}
              <div>
                <h1 className='text-2xl font-bold tracking-tight text-foreground'>
                  {project.name}
                </h1>
                <p className='text-xs text-muted-foreground'>
                  {project.description || 'Project documentation workspace'}
                </p>
              </div>
            </div>

            <Button
              variant='outline'
              size='sm'
              onClick={() => setEditProjectOpen(true)}
              className='h-8 gap-1.5 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground'
            >
              <Pencil className='size-3.5' />
              <span className='hidden sm:inline'>Edit Project</span>
            </Button>
          </div>

          <div className='mt-2 flex flex-wrap items-center justify-between gap-3'>
            <div className='flex items-center gap-2 text-xs text-muted-foreground'>
              <span className='rounded-full bg-muted px-2.5 py-0.5 font-medium text-foreground'>
                {project.totalDocsCount}{' '}
                {project.totalDocsCount === 1 ? 'document' : 'documents'}
              </span>
              <span>·</span>
              <span>Updated {formatRelativeTime(project.updatedAt)}</span>
            </div>

            <div className='flex items-center gap-2'>
              <div className='relative w-48 sm:w-60'>
                <Search className='absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground' />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder='Search within project...'
                  className='h-8 pl-8 text-xs'
                />
              </div>

              <div className='flex items-center rounded-md border border-border/80 p-0.5'>
                <Button
                  variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                  size='icon'
                  className='size-7'
                  onClick={() => setViewMode('grid')}
                >
                  <LayoutGrid className='size-3.5' />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                  size='icon'
                  className='size-7'
                  onClick={() => setViewMode('list')}
                >
                  <List className='size-3.5' />
                </Button>
              </div>
            </div>
          </div>
        </div>

        <ProjectCategoryFilter
          projectId={project.id}
          categories={project.categories ?? []}
          selectedCategories={selectedCategories}
          onToggleCategory={handleToggleCategory}
          onClearCategories={handleClearCategories}
          docCountsByCategory={docCountsByCategory}
          totalDocsCount={project.totalDocsCount}
        />

        {filteredDocs.length === 0 ? (
          <div className='flex min-h-[30vh] flex-col items-center justify-center rounded-xl border border-dashed border-border/80 p-8 text-center'>
            <p className='text-xs text-muted-foreground'>
              {selectedCategories.length === 0
                ? 'No documents in this project yet.'
                : `No documents found in selected categories (${selectedCategories.join(', ')}).`}
            </p>
            <Button
              size='sm'
              className='mt-3 text-xs gap-1.5'
              onClick={() => setCreateDocOpen(true)}
            >
              <Plus className='size-3.5' />
              <span>Create Document</span>
            </Button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
            {filteredDocs.map((doc) => (
              <DocCard key={doc.id} document={doc} />
            ))}
          </div>
        ) : (
          <div className='flex flex-col gap-2'>
            {filteredDocs.map((doc) => (
              <DocListRow key={doc.id} document={doc} />
            ))}
          </div>
        )}
      </Main>

      <CreateDocDialog
        open={createDocOpen}
        onOpenChange={setCreateDocOpen}
        preselectedProjectId={project.id}
        defaultCategories={selectedCategories}
        defaultCategory={selectedCategories[0] ?? null}
      />

      <ImportDocDialog
        open={importDocOpen}
        onOpenChange={setImportDocOpen}
        preselectedProjectId={project.id}
      />

      <EditProjectDialog
        open={editProjectOpen}
        onOpenChange={setEditProjectOpen}
        project={project}
      />
    </>
  )
}
