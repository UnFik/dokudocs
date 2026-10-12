import { Skeleton } from '@/components/ui/skeleton'
import { useDokudocs } from '@/features/dashboard/hooks/use-dokudocs'

const CARD_COUNT = 4
const PROJECT_COUNT = 3

function DocCardSkeleton() {
  return (
    <div className='overflow-hidden rounded-xl border border-border/80 bg-card'>
      <Skeleton className='h-32 w-full rounded-none' />
      <div className='space-y-2.5 p-3.5'>
        <Skeleton className='h-4 w-16 rounded-sm' />
        <Skeleton className='h-4 w-3/4' />
        <div className='flex items-center gap-1.5 pt-1'>
          <Skeleton className='size-4 rounded-full' />
          <Skeleton className='h-3 w-24' />
        </div>
      </div>
    </div>
  )
}

function DocListRowSkeleton() {
  return (
    <div className='flex items-center justify-between rounded-lg border border-border/60 bg-card px-4 py-2.5'>
      <div className='flex min-w-0 flex-1 items-center gap-3'>
        <Skeleton className='size-4' />
        <Skeleton className='h-4 w-40 max-w-full' />
        <Skeleton className='hidden h-4 w-14 rounded-sm sm:block' />
      </div>
      <div className='flex items-center gap-6'>
        <Skeleton className='hidden h-3 w-28 sm:block' />
        <Skeleton className='h-3 w-20' />
      </div>
    </div>
  )
}

function ProjectCardSkeleton() {
  return (
    <div className='rounded-xl border border-border/80 bg-card p-4'>
      <div className='flex items-center gap-2.5'>
        <Skeleton className='size-9 shrink-0 rounded-lg' />
        <div className='min-w-0 flex-1 space-y-1.5'>
          <Skeleton className='h-4 w-32 max-w-full' />
          <Skeleton className='h-3 w-20' />
        </div>
      </div>
      <div className='mt-6 grid grid-cols-2 grid-rows-2 gap-2.5 rounded-xl border border-border/50 bg-muted/30 p-2.5'>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className='h-24 rounded-lg' />
        ))}
      </div>
      <div className='mt-4 flex items-center justify-between border-t border-border/50 pt-3'>
        <Skeleton className='h-3 w-20' />
        <Skeleton className='h-3 w-24' />
      </div>
    </div>
  )
}

export function RecentSectionSkeleton() {
  const { viewMode } = useDokudocs()

  return (
    <div className='space-y-3.5'>
      <div>
        <h2 className='text-base font-semibold tracking-tight text-foreground'>
          Recent Documents
        </h2>
        <p className='text-xs text-muted-foreground'>
          Documents and diagrams accessed across your workspace
        </p>
      </div>

      {viewMode === 'grid' ? (
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
          {Array.from({ length: CARD_COUNT }, (_, i) => (
            <DocCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className='space-y-2'>
          {Array.from({ length: CARD_COUNT }, (_, i) => (
            <DocListRowSkeleton key={i} />
          ))}
        </div>
      )}
    </div>
  )
}

export function ProjectsSectionSkeleton() {
  return (
    <div className='space-y-3.5'>
      <div>
        <h2 className='text-base font-semibold tracking-tight text-foreground'>
          Projects
        </h2>
        <p className='text-xs text-muted-foreground'>
          Organized workspace folders and module documentation
        </p>
      </div>

      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        {Array.from({ length: PROJECT_COUNT }, (_, i) => (
          <ProjectCardSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}
