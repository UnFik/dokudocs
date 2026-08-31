import { useState } from 'react'
import { Building2 } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDokudocsStore } from '@/stores/dokudocs-store'

interface CreateWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: CreateWorkspaceDialogProps) {
  const [workspaceName, setWorkspaceName] = useState('')
  const createOrganization = useDokudocsStore((state) => state.createOrganization)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = workspaceName.trim()
    if (!trimmed) {
      toast.error('Please enter a workspace name')
      return
    }

    const newOrg = createOrganization(trimmed, 'Free')
    toast.success(`Workspace "${newOrg.name}" created!`)
    setWorkspaceName('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[420px]'>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <div className='flex items-center gap-2.5'>
              <div className='flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary'>
                <Building2 className='size-5' />
              </div>
              <div>
                <DialogTitle className='text-base font-semibold'>
                  Create Workspace
                </DialogTitle>
                <DialogDescription className='text-xs text-muted-foreground'>
                  Create a new space for your documents and projects.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className='space-y-4 py-4'>
            <div className='space-y-1.5'>
              <Label htmlFor='workspace-name' className='text-xs font-medium'>
                Workspace Name
              </Label>
              <Input
                id='workspace-name'
                placeholder='e.g. Acme Corp, Engineering, Personal'
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                autoFocus
                className='text-xs'
              />
            </div>
          </div>

          <DialogFooter className='gap-2 sm:gap-0'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => onOpenChange(false)}
              className='text-xs'
            >
              Cancel
            </Button>
            <Button type='submit' size='sm' className='text-xs'>
              Create Workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
