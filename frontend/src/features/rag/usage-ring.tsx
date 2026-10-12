import type { RAGUsage } from '@/lib/domain-api'
import { cn } from '@/lib/utils'
import { formatTokens, resetLabel, usagePercent } from './conversation-format'

const RADIUS = 7
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * This month's AI use as a ring. The fill carries the amount; the color only
 * adds urgency at 80% and 100%. The label has the numbers for everyone else.
 */
export function UsageRing({ usage }: { usage: RAGUsage }) {
  const percent = usagePercent(usage)
  const reset = resetLabel(usage.resetsAt)
  const label = `${percent}% of this month's AI use: ${formatTokens(usage.used)} of ${formatTokens(usage.limit)} tokens${reset ? `, resets ${reset}` : ''}`
  return (
    <a
      href='/settings/ai'
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-11 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:size-8',
        percent >= 100
          ? 'text-destructive'
          : percent >= 80
            ? 'text-warn'
            : 'text-muted-foreground'
      )}
    >
      <svg viewBox='0 0 20 20' className='size-5' aria-hidden='true'>
        <circle
          cx='10'
          cy='10'
          r={RADIUS}
          fill='none'
          stroke='currentColor'
          strokeOpacity='0.25'
          strokeWidth='2.5'
        />
        <circle
          cx='10'
          cy='10'
          r={RADIUS}
          fill='none'
          stroke='currentColor'
          strokeWidth='2.5'
          strokeDasharray={`${(percent / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          transform='rotate(-90 10 10)'
        />
      </svg>
    </a>
  )
}
