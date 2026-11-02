import { StickyNote } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'

interface DbmlNoteHintProps {
  label: string
  text: string
  className?: string
}

export function DbmlNoteHint({ label, text, className }: DbmlNoteHintProps) {
  return (
    <HoverCard openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type='button'
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className={cn(
            'flex size-5 shrink-0 cursor-help items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
            className
          )}
        >
          <StickyNote className='size-3.5' />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        className='w-auto max-w-xs text-xs break-words whitespace-pre-wrap'
        onMouseDown={(e) => e.stopPropagation()}
      >
        {text}
      </HoverCardContent>
    </HoverCard>
  )
}
