import type { DocType } from '@/lib/document-types'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

const LINE_WIDTHS = ['w-3/4', 'w-full', 'w-11/12', 'w-2/3', 'w-5/6']
const CODE_WIDTHS = ['w-1/3', 'w-2/3', 'w-1/2', 'w-3/4', 'w-2/5', 'w-1/2']

function SkeletonLines() {
  return (
    <div aria-hidden='true' className='space-y-3'>
      {LINE_WIDTHS.map((width) => (
        <Skeleton key={width} className={cn('h-4', width)} />
      ))}
    </div>
  )
}

// DBML and Mermaid open as source on the left and a rendered diagram on the right.
function SkeletonSource() {
  return (
    <div aria-hidden='true' className='grid gap-6 md:grid-cols-2'>
      <div className='space-y-3'>
        {CODE_WIDTHS.map((width, index) => (
          <Skeleton
            key={`${width}-${index}`}
            className={cn('h-3 rounded-sm', width)}
          />
        ))}
      </div>
      <Skeleton className='hidden h-64 w-full md:block' />
    </div>
  )
}

// A canvas shows nodes joined by connectors, not lines of text.
function SkeletonCanvas() {
  return (
    <div
      aria-hidden='true'
      className='relative h-72 w-full overflow-hidden rounded-md border border-border'
    >
      <Skeleton className='absolute top-8 left-[8%] h-14 w-32' />
      <Skeleton className='absolute top-8 right-[10%] h-14 w-32' />
      <Skeleton className='absolute bottom-10 left-[38%] h-14 w-32' />
      <Skeleton className='absolute top-[3.75rem] left-[calc(8%+8rem)] h-0.5 w-[34%]' />
      <Skeleton className='absolute top-[calc(2rem+3.5rem)] left-[calc(8%+4rem)] h-20 w-0.5' />
    </div>
  )
}

// With no type known yet, one empty block avoids guessing a layout that may be wrong.
function SkeletonUnknown() {
  return <Skeleton aria-hidden='true' className='h-64 w-full' />
}

function SkeletonBody({
  type,
  unknown,
}: {
  type?: DocType
  unknown?: boolean
}) {
  if (type === 'dbdiagram' || type === 'mermaid') return <SkeletonSource />
  if (type === 'architecture') return <SkeletonCanvas />
  if (type === 'markdown' || !unknown) return <SkeletonLines />
  return <SkeletonUnknown />
}

interface DocSkeletonProps {
  label: string
  className?: string
  // Omit while the type is not known yet; the skeleton then stays neutral.
  type?: DocType
}

// Neither skeleton uses role='status': the editor toolbar owns the only status region ("Synced"), and smoke specs find it by role.
export function DocBodySkeleton({ label, className, type }: DocSkeletonProps) {
  return (
    <div aria-busy='true' className={className}>
      <span className='sr-only'>{label}</span>
      <SkeletonBody type={type} />
    </div>
  )
}

export function DocEditorSkeleton({
  label,
  className,
  type,
}: DocSkeletonProps) {
  return (
    <div
      aria-busy='true'
      className={cn('mx-auto w-full max-w-4xl space-y-6 p-6', className)}
    >
      <span className='sr-only'>{label}</span>
      <Skeleton aria-hidden='true' className='h-8 w-1/2' />
      <SkeletonBody type={type} unknown={!type} />
    </div>
  )
}
