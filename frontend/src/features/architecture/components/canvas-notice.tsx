import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { useCanvasNotice } from '../lib/canvas-notice'
import './canvas-notice.css'

/**
 * A check beside the canvas tool bar that confirms something worked. It leaves on
 * its own; pointing at it (or focusing it) shows what happened and keeps it there.
 */
export function CanvasNotice() {
  const message = useCanvasNotice((s) => s.message)
  const hold = useCanvasNotice((s) => s.hold)
  if (message === null) return null
  return (
    <HoverCard openDelay={0} closeDelay={80} onOpenChange={hold}>
      <HoverCardTrigger asChild>
        <button
          type='button'
          data-slot='canvas-notice'
          aria-label='Done'
          className='canvas-notice nopan nodrag relative grid size-9 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal dark:text-emerald-400'
        >
          <svg
            viewBox='0 0 24 24'
            className='size-[18px] fill-none stroke-current'
            strokeWidth={2.6}
            strokeLinecap='round'
            strokeLinejoin='round'
            aria-hidden
          >
            <path d='M5 12.5l4.5 4.5L19 7.5' />
          </svg>
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side='top'
        className='w-auto max-w-72 px-3 py-2 text-xs'
        role='status'
      >
        {message}
      </HoverCardContent>
    </HoverCard>
  )
}
