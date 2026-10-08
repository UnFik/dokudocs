import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface DocumentInsights {
  views: number
  /** Null while the history is still loading. */
  versions: number | null
  contributors: number | null
  createdBy: string
  createdAt: string
}

/** Ctrl+Shift+I: how the page has been used and by whom. */
export function DocumentInsightsDialog({
  open,
  insights,
  onOpenChange,
}: {
  open: boolean
  insights: DocumentInsights
  onOpenChange: (open: boolean) => void
}) {
  const rows: [string, string][] = [
    ['Views', String(insights.views)],
    [
      'Saved versions',
      insights.versions === null ? 'Loading…' : String(insights.versions),
    ],
    [
      'People who edited',
      insights.contributors === null ? 'Loading…' : String(insights.contributors),
    ],
    ['Created by', insights.createdBy],
    [
      'Created',
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
        new Date(insights.createdAt)
      ),
    ],
  ]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-sm'>
        <DialogHeader>
          <DialogTitle>Insights</DialogTitle>
          <DialogDescription>How this page has been used.</DialogDescription>
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
