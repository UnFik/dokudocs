import { useMemo, useState } from 'react'
import { getRouteApi, Link } from '@tanstack/react-router'
import type { ViewMode } from '@/types/dokudocs'
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
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { getDocCategories } from '@/lib/doc-category-utils'
import { formatRelativeTime } from '@/lib/time-utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { useDokudocs } from '@/features/dashboard/hooks/use-dokudocs'
import { CreateDocDialog } from '@/features/docs/components/create-doc-dialog'
import { DocCard } from '@/features/docs/components/doc-card'
import { DocListRow } from '@/features/docs/components/doc-list-row'
import { ImportDocDialog } from '@/features/docs/components/import-doc-dialog'
import { EditProjectDialog } from './edit-project-dialog'
import { ProjectCategoryFilter } from './project-category-filter'

const route = getRouteApi('/_authenticated/projects/$projectId')

export function ProjectDetailView() {
  const { projectId } = route.useParams()
  const { categories = [], q = '', viewMode = 'grid' } = route.useSearch()
  const navigate = route.useNavigate()

  const { projectsWithDocs } = useDokudocs()
  const toggleStarProject = useDokudocsStore((s) => s.toggleStarProject)

  const project = projectsWithDocs.find((p) => p.id === projectId)
  const [createDocOpen, setCreateDocOpen] = useState(false)
  const [importDocOpen, setImportDocOpen] = useState(false)
  const [editProjectOpen, setEditProjectOpen] = useState(false)

  const handleToggleCategory = (cat: string) => {
    const nextCategories = categories.includes(cat)
      ? categories.filter((c) => c !== cat)
      : [...categories, cat]

    navigate({
      search: (prev) => ({
        ...prev,
        categories: nextCategories.length > 0 ? nextCategories : undefined,
      }),
      replace: false,
    })
  }

  const handleClearCategories = () => {
    navigate({
      search: (prev) => ({
        ...prev,
        categories: undefined,
      }),
      replace: false,
    })
  }

  const handleSearchChange = (value: string) => {
    navigate({
      search: (prev) => ({
        ...prev,
        q: value || undefined,
      }),
      replace: true,
    })
  }

  const handleViewModeChange = (mode: ViewMode) => {
    navigate({
      search: (prev) => ({
        ...prev,
        viewMode: mode === 'grid' ? undefined : mode,
      }),
      replace: false,
    })
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
      categories.length > 0 &&
      !categories.some((cat) => docCats.includes(cat))
    ) {
      return false
    }

    if (!q.trim()) return true
    const searchLower = q.toLowerCase()
    return (
      doc.title.toLowerCase().includes(searchLower) ||
      docCats.some((c) => c.toLowerCase().includes(searchLower)) ||
      doc.tags?.some((t) => t.toLowerCase().includes(searchLower))
    )
  })

  return (
    <>
      <Header fixed>
        <div className='flex items-center gap-2 text-sm'>
          <Link
            to='/projects'
            className='flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground'
          >
            <ArrowLeft className='size-3.5' />
            <span>Projects</span>
          </Link>
          <span className='text-muted-foreground/60'>/</span>
          <span className='max-w-48 truncate font-semibold'>
            {project.name}
          </span>
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

      <Main className='space-y-6 pt-4 pb-12'>
        <div className='flex flex-col gap-3 border-b border-border/40 pb-5'>
          <div className='flex items-center justify-between gap-4'>
            <div className='flex items-center gap-3'>
              {project.logoUrl ? (
                <img
                  src={project.logoUrl}
                  alt={project.name}
                  className='size-11 shrink-0 rounded-xl border border-border object-cover shadow-2xs'
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
                <Search className='absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground' />
                <Input
                  value={q}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder='Search within project...'
                  className='h-8 pl-8 text-xs'
                />
              </div>

              <div className='flex items-center rounded-md border border-border/80 p-0.5'>
                <Button
                  variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                  size='icon'
                  className='size-7'
                  onClick={() => handleViewModeChange('grid')}
                >
                  <LayoutGrid className='size-3.5' />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                  size='icon'
                  className='size-7'
                  onClick={() => handleViewModeChange('list')}
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
          selectedCategories={categories}
          onToggleCategory={handleToggleCategory}
          onClearCategories={handleClearCategories}
          docCountsByCategory={docCountsByCategory}
          totalDocsCount={project.totalDocsCount}
        />

        {filteredDocs.length === 0 ? (
          <div className='flex min-h-[30vh] flex-col items-center justify-center rounded-xl border border-dashed border-border/80 p-8 text-center'>
            <p className='text-xs text-muted-foreground'>
              {categories.length === 0
                ? 'No documents in this project yet.'
                : `No documents found in selected categories (${categories.join(', ')}).`}
            </p>
            <Button
              size='sm'
              className='mt-3 gap-1.5 text-xs'
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
        defaultCategories={categories}
        defaultCategory={categories[0] ?? null}
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
