import { DocType } from '@/types/dokudocs'
import { cn } from '@/lib/utils'

interface DocThumbnailPreviewProps {
  type: DocType
  className?: string
}

export function DocThumbnailPreview({
  type,
  className,
}: DocThumbnailPreviewProps) {
  if (type === 'markdown') {
    return (
      <div
        className={cn(
          'relative flex h-full w-full flex-col justify-start overflow-hidden bg-gradient-to-b from-blue-500/5 via-muted/20 to-transparent p-2.5 select-none',
          className
        )}
      >
        <div className='mb-1.5 h-2 w-2/5 rounded-full bg-blue-500/40' />
        <div className='mb-1 h-1.5 w-4/5 rounded-full bg-foreground/20' />
        <div className='mb-1 h-1.5 w-3/4 rounded-full bg-foreground/15' />
        <div className='mb-2 h-1.5 w-1/2 rounded-full bg-foreground/15' />
        <div className='space-y-0.5 border-l border-blue-500/40 pl-1.5'>
          <div className='h-1 w-2/3 rounded-full bg-foreground/20' />
          <div className='h-1 w-1/2 rounded-full bg-foreground/15' />
        </div>
      </div>
    )
  }

  if (type === 'dbdiagram') {
    return (
      <div
        className={cn(
          'relative flex h-full w-full items-center justify-center gap-1.5 overflow-hidden bg-gradient-to-b from-emerald-500/5 via-muted/20 to-transparent p-2 select-none',
          className
        )}
      >
        <div className='flex w-16 flex-col rounded border border-emerald-500/40 bg-background/90 p-1 shadow-2xs'>
          <div className='mb-1 h-1.5 w-full rounded bg-emerald-500/50' />
          <div className='space-y-0.5'>
            <div className='h-0.5 w-full rounded bg-foreground/25' />
            <div className='h-0.5 w-3/4 rounded bg-foreground/20' />
            <div className='h-0.5 w-1/2 rounded bg-foreground/15' />
          </div>
        </div>

        <div className='h-px w-2.5 bg-emerald-500/60' />

        <div className='flex w-16 flex-col rounded border border-emerald-500/40 bg-background/90 p-1 shadow-2xs'>
          <div className='mb-1 h-1.5 w-full rounded bg-emerald-500/50' />
          <div className='space-y-0.5'>
            <div className='h-0.5 w-full rounded bg-foreground/25' />
            <div className='h-0.5 w-2/3 rounded bg-foreground/20' />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative flex h-full w-full items-center justify-center gap-1 overflow-hidden bg-gradient-to-b from-purple-500/5 via-muted/20 to-transparent p-2 select-none',
        className
      )}
    >
      <div className='flex size-5 items-center justify-center rounded-full border border-purple-500/50 bg-background/90 text-[7px] font-bold text-purple-600 dark:text-purple-400 shadow-2xs'>
        A
      </div>
      <div className='h-px w-2 bg-purple-500/50' />
      <div className='flex size-5.5 items-center justify-center rounded-md border border-purple-500/60 bg-background/90 text-[7px] font-bold text-purple-600 dark:text-purple-400 shadow-2xs'>
        B
      </div>
      <div className='h-px w-2 bg-purple-500/50' />
      <div className='flex size-5 items-center justify-center rounded-full border border-purple-500/50 bg-background/90 text-[7px] font-bold text-purple-600 dark:text-purple-400 shadow-2xs'>
        C
      </div>
    </div>
  )
}
