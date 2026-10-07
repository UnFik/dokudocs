import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { DocumentStats } from '../lib/document-stats'

const number = new Intl.NumberFormat('en-US')

/** Ctrl+Shift+G: what the page holds, and how much room is left. */
export function DocumentStatsDialog({
  open,
  stats,
  limit,
  onOpenChange,
}: {
  open: boolean
  stats: DocumentStats
  limit: number
  onOpenChange: (open: boolean) => void
}) {
  const rows: [string, string][] = [
    ['Words', number.format(stats.words)],
    [
      'Characters',
      `${number.format(stats.characters)} of ${number.format(limit)}`,
    ],
    ['Reading time', `${stats.readingMinutes} min`],
    ['Headings', number.format(stats.headings)],
    ['Tasks', `${stats.tasks.done} of ${stats.tasks.total} done`],
  ]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-sm'>
        <DialogHeader>
          <DialogTitle>Page statistics</DialogTitle>
          <DialogDescription>What this page holds right now.</DialogDescription>
        </DialogHeader>
        <dl className='grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm'>
          {rows.map(([label, value]) => (
            <div key={label} className='contents'>
              <dt className='text-muted-foreground'>{label}</dt>
              <dd className='text-right font-medium'>{value}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
