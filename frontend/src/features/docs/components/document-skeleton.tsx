import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

const LINE_WIDTHS = ['w-3/4', 'w-full', 'w-11/12', 'w-2/3', 'w-5/6']

function SkeletonLines() {
  return (
    <div aria-hidden='true' className='space-y-3'>
      {LINE_WIDTHS.map((width) => (
        <Skeleton key={width} className={cn('h-4', width)} />
      ))}
    </div>
  )
}

interface DocSkeletonProps {
  label: string
  className?: string
}

// Neither skeleton uses role='status': the editor toolbar owns the only status region ("Synced"), and smoke specs find it by role.
export function DocBodySkeleton({ label, className }: DocSkeletonProps) {
  return (
    <div aria-busy='true' className={className}>
      <span className='sr-only'>{label}</span>
      <SkeletonLines />
    </div>
  )
}

export function DocEditorSkeleton({ label, className }: DocSkeletonProps) {
  return (
    <div
      aria-busy='true'
      className={cn('mx-auto w-full max-w-4xl space-y-6 p-6', className)}
    >
      <span className='sr-only'>{label}</span>
      <Skeleton aria-hidden='true' className='h-8 w-1/2' />
      <SkeletonLines />
    </div>
  )
}
