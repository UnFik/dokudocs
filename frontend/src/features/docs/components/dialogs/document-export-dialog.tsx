import { useState } from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  exportDocument,
  exportFileName,
  type ExportContext,
  type ExportFormat,
} from '../../lib/export-document'

const FORMATS: { id: ExportFormat; label: string; about: string }[] = [
  { id: 'md', label: 'Markdown', about: 'Plain text that opens in any editor' },
  { id: 'pdf', label: 'PDF', about: 'Paginated, for sharing and printing' },
  { id: 'docx', label: 'Word', about: 'An editable Word document' },
]

const NEEDS_CONNECTION: Partial<Record<ExportFormat, string>> = {
  pdf: 'PDF needs a connection',
}

interface DocumentExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  context: ExportContext
  offline: boolean
}

/** Exports a Markdown document as `.md`, `.pdf` or `.docx`. */
export function DocumentExportDialog({
  open,
  onOpenChange,
  context,
  offline,
}: DocumentExportDialogProps) {
  const [chosen, setFormat] = useState<ExportFormat>(offline ? 'md' : 'pdf')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const unavailable = (id: ExportFormat) =>
    offline ? NEEDS_CONNECTION[id] : undefined
  // A format that needs a connection is not exported once the connection is gone.
  const format = unavailable(chosen) ? 'md' : chosen

  const run = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const name = await exportDocument(format, context)
      toast.success(`Exported ${name}`)
      onOpenChange(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  const choose = (value: ExportFormat) => {
    setFormat(value)
    setError(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2 text-base'>
            <Download className='size-4 text-primary' aria-hidden />
            Export document
          </DialogTitle>
          <DialogDescription className='text-xs'>
            Choose a format for the file.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          aria-label='Format'
          value={format}
          onValueChange={(value) => choose(value as ExportFormat)}
          disabled={busy}
        >
          {FORMATS.map(({ id, label, about }) => {
            const reason = unavailable(id)
            const describedBy = reason
              ? `export-format-${id}-reason`
              : `export-format-${id}-about`
            return (
              <div
                key={id}
                className='relative flex items-start gap-3 rounded-lg border p-3 has-[:disabled]:opacity-60 has-[[data-state=checked]]:border-primary'
              >
                <RadioGroupItem
                  id={`export-format-${id}`}
                  value={id}
                  disabled={Boolean(reason)}
                  aria-describedby={describedBy}
                  className='mt-0.5'
                />
                <div className='min-w-0'>
                  <Label
                    htmlFor={`export-format-${id}`}
                    className='text-sm font-medium after:absolute after:inset-0'
                  >
                    {label}{' '}
                    <span className='text-xs font-normal text-muted-foreground'>
                      .{id}
                    </span>
                  </Label>
                  <p id={describedBy} className='text-xs text-muted-foreground'>
                    {reason ?? about}
                  </p>
                </div>
              </div>
            )
          })}
        </RadioGroup>
        <p className='truncate text-xs text-muted-foreground'>
          {exportFileName(context.title, format)}
        </p>
        {error ? (
          <p role='alert' className='text-sm text-destructive'>
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type='button' disabled={busy} onClick={() => void run()}>
            {busy ? 'Exporting…' : 'Export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
