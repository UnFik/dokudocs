import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { LineChange } from '../lib/revision-changes'

/** What changed from the version before, one change at a time. */
export function RevisionChanges({ changes }: { changes: LineChange[] }) {
  const [current, setCurrent] = useState(0)
  if (changes.length === 0)
    return (
      <p className='text-[11px] text-muted-foreground'>
        No changes from the version before.
      </p>
    )
  const at = Math.min(current, changes.length - 1)
  return (
    <div className='text-[11px]'>
      <div className='mb-1 flex items-center justify-between'>
        <span className='text-muted-foreground'>
          Change {at + 1} of {changes.length}
        </span>
        <span className='flex gap-0.5'>
          <Button
            size='icon'
            variant='ghost'
            className='size-6'
            aria-label='Previous change'
            disabled={at === 0}
            onClick={() => setCurrent(at - 1)}
          >
            <ChevronUp className='size-3.5' />
          </Button>
          <Button
            size='icon'
            variant='ghost'
            className='size-6'
            aria-label='Next change'
            disabled={at === changes.length - 1}
            onClick={() => setCurrent(at + 1)}
          >
            <ChevronDown className='size-3.5' />
          </Button>
        </span>
      </div>
      <ul className='max-h-28 overflow-auto rounded-md border border-border/60 bg-background/80 font-mono text-[10px]'>
        {changes.map((change, index) => (
          <li
            key={index}
            ref={(node) => {
              if (index === at) node?.scrollIntoView?.({ block: 'nearest' })
            }}
            aria-current={index === at ? 'true' : undefined}
            className={`px-2 py-0.5 whitespace-pre-wrap ${
              change.kind === 'added'
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'bg-red-500/10 text-red-700 line-through dark:text-red-300'
            } ${index === at ? 'ring-1 ring-primary' : ''}`}
          >
            {change.text || ' '}
          </li>
        ))}
      </ul>
    </div>
  )
}
