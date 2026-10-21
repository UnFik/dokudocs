import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { isWebAddress } from '../lib/web-address'

/**
 * Opens a System's repository in a new tab, after asking: it leaves DokuDocs for
 * an address someone typed into the document.
 */
export function RepositoryJump({
  url,
  name,
  className,
}: {
  url: string
  name: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  if (!isWebAddress(url)) return null
  return (
    <>
      <button
        type='button'
        className={className}
        aria-label={`Open the repository of ${name || 'this System'}`}
        onClick={() => setOpen(true)}
      >
        <ExternalLink className='size-3.5' strokeWidth={1.5} aria-hidden />
        Repository
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Open the repository?</AlertDialogTitle>
            <AlertDialogDescription>
              This opens a site outside DokuDocs in a new tab.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className='font-mono text-xs break-all'>{url}</p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
            >
              Open repository
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
