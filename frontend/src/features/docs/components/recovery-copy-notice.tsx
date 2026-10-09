import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  discardRecoveryCopy,
  recoveryCopiesFor,
  type RecoveryCopy,
} from '../lib/recovery-copies'

function download(copy: RecoveryCopy, extension: string) {
  const url = URL.createObjectURL(
    new Blob([copy.source], { type: 'text/plain;charset=utf-8' })
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `${copy.title || 'diagram'}-unsent-edits.${extension}`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Tells this person that a restore replaced a version holding edits their device
 * never sent. The edits stay out of the document; they can copy, download or
 * discard them, and nothing blocks editing meanwhile.
 */
export function RecoveryCopyNotice({
  documentID,
  extension = 'txt',
}: {
  documentID: string
  /** The file extension a download gets, such as `dbml` or `mmd`. */
  extension?: string
}) {
  const [copies, setCopies] = useState(() => recoveryCopiesFor(documentID))
  if (!copies.length) return null
  const copy = copies[copies.length - 1]
  const discard = () => {
    discardRecoveryCopy(documentID, copy.record)
    setCopies(recoveryCopiesFor(documentID))
  }

  return (
    <div
      role='status'
      className='flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card px-4 py-2 text-[13px]'
    >
      <span className='flex min-w-0 flex-1 items-center gap-2'>
        <i className='size-1.5 shrink-0 rounded-[1px] bg-warn' aria-hidden />
        <span>
          This diagram was restored to an earlier version. Edits this device had
          not sent are kept here, outside the document.
          {copies.length > 1 && (
            <span className='text-muted-foreground'>
              {' '}
              ({copies.length} sets, newest shown)
            </span>
          )}
        </span>
      </span>
      <span className='flex shrink-0 items-center gap-2'>
        <Button
          size='sm'
          variant='outline'
          onClick={() =>
            void navigator.clipboard
              .writeText(copy.source)
              .then(() => toast.success('Unsent edits copied'))
              .catch(() =>
                toast.error('Copying failed. Download them instead.')
              )
          }
        >
          Copy
        </Button>
        <Button
          size='sm'
          variant='outline'
          onClick={() => download(copy, extension)}
        >
          Download
        </Button>
        <Button size='sm' variant='danger' onClick={discard}>
          Discard
        </Button>
      </span>
    </div>
  )
}
