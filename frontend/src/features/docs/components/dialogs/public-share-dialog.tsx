import { useMutation } from '@tanstack/react-query'
import { Copy, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { createDocumentShareToken } from '@/lib/domain-api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export function PublicShareDialog({
  open,
  onOpenChange,
  workspaceID,
  documentID,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceID: string
  documentID: string
}) {
  const tokenMutation = useMutation({
    mutationFn: () => createDocumentShareToken(workspaceID, documentID),
    onError: (error) => toast.error(error.message),
  })
  const shareURL = tokenMutation.data
    ? `${window.location.origin}/public/documents/${encodeURIComponent(tokenMutation.data)}`
    : ''

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareURL)
      toast.success('Public link copied')
    } catch {
      toast.error('Could not copy public link')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Share document</DialogTitle>
          <DialogDescription>
            Anyone with this link can view the published document.
          </DialogDescription>
        </DialogHeader>
        {shareURL ? (
          <div className='flex gap-2'>
            <Input aria-label='Public link' readOnly value={shareURL} />
            <Button type='button' variant='outline' onClick={copyLink}>
              <Copy className='size-4' />
              Copy link
            </Button>
          </div>
        ) : (
          <Button
            type='button'
            onClick={() => tokenMutation.mutate()}
            disabled={tokenMutation.isPending}
          >
            <Link2 className='size-4' />
            {tokenMutation.isPending ? 'Creating link…' : 'Create public link'}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}
