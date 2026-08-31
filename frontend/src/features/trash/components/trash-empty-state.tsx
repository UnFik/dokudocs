import { Link } from '@tanstack/react-router'
import { ArrowLeft, Trash } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function TrashEmptyState() {
  return (
    <div className='flex min-h-[50vh] flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-card/50 p-12 text-center'>
      <div className='flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-2xs'>
        <Trash className='size-7 stroke-[1.5]' />
      </div>
      <h3 className='mt-4 text-base font-semibold text-foreground'>
        Trash is empty
      </h3>
      <p className='mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground'>
        Deleted documents will be stored here for 30 days before being permanently removed.
      </p>
      <Button asChild variant='outline' size='sm' className='mt-6 text-xs gap-1.5'>
        <Link to='/'>
          <ArrowLeft className='size-3.5' />
          <span>Back to Recents</span>
        </Link>
      </Button>
    </div>
  )
}
