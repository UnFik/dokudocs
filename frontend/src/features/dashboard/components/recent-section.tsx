import {
  ArrowUpDown,
  FileQuestion,
  LayoutGrid,
  List,
  Plus,
} from 'lucide-react'
import { SortField, SortOrder } from '@/types/dokudocs'
import { useDokudocs } from '@/features/dashboard/hooks/use-dokudocs'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DocCard } from '@/features/docs/components/doc-card'
import { DocListRow } from '@/features/docs/components/doc-list-row'

interface RecentSectionProps {
  onOpenCreateDialog: () => void
}

export function RecentSection({ onOpenCreateDialog }: RecentSectionProps) {
  const {
    activeDocuments,
    viewMode,
    setViewMode,
    sortField,
    sortOrder,
    setSorting,
  } = useDokudocs()

  const sortOptions: { label: string; field: SortField; order: SortOrder }[] = [
    { label: 'Recently viewed', field: 'lastViewedAt', order: 'desc' },
    { label: 'Recently updated', field: 'updatedAt', order: 'desc' },
    { label: 'Recently created', field: 'createdAt', order: 'desc' },
    { label: 'Title (A-Z)', field: 'title', order: 'asc' },
    { label: 'Title (Z-A)', field: 'title', order: 'desc' },
  ]

  const currentSortLabel =
    sortOptions.find(
      (opt) => opt.field === sortField && opt.order === sortOrder
    )?.label || 'Sort by'

  return (
    <div className='space-y-3.5'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div>
          <h2 className='text-base font-semibold tracking-tight text-foreground'>
            Recent Documents
          </h2>
          <p className='text-xs text-muted-foreground'>
            Documents and diagrams accessed across your workspace
          </p>
        </div>

        <div className='flex items-center gap-2'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='outline' size='sm' className='h-8 text-xs gap-1.5'>
                <ArrowUpDown className='size-3.5 text-muted-foreground' />
                <span>{currentSortLabel}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-44'>
              {sortOptions.map((opt) => (
                <DropdownMenuItem
                  key={`${opt.field}-${opt.order}`}
                  onClick={() => setSorting(opt.field, opt.order)}
                  className='text-xs'
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className='flex items-center rounded-md border border-border/80 p-0.5 bg-muted/30'>
            <Button
              variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
              size='icon'
              className='size-7 rounded-sm'
              onClick={() => setViewMode('grid')}
            >
              <LayoutGrid className='size-3.5' />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              size='icon'
              className='size-7 rounded-sm'
              onClick={() => setViewMode('list')}
            >
              <List className='size-3.5' />
            </Button>
          </div>
        </div>
      </div>

      {activeDocuments.length === 0 ? (
        <div className='flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center bg-card/40'>
          <div className='flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground mb-3'>
            <FileQuestion className='size-6' />
          </div>
          <h3 className='text-sm font-semibold text-foreground'>
            No documents found
          </h3>
          <p className='mt-1 max-w-sm text-xs text-muted-foreground'>
            No documentation files match the active filters or search criteria.
          </p>
          <Button
            size='sm'
            onClick={onOpenCreateDialog}
            className='mt-4 text-xs'
          >
            <Plus className='mr-1.5 size-3.5' />
            Create Document
          </Button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
          {activeDocuments.map((doc) => (
            <DocCard key={doc.id} document={doc} />
          ))}
        </div>
      ) : (
        <div className='space-y-2'>
          {activeDocuments.map((doc) => (
            <DocListRow key={doc.id} document={doc} />
          ))}
        </div>
      )}
    </div>
  )
}
