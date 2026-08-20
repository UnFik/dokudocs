import { useState } from 'react'
import { FileEdit, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CreateDocDialog } from '@/features/docs/components/create-doc-dialog'

export function DraftsEmptyState() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  return (
    <>
      <div className='flex min-h-[50vh] flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-card/50 p-12 text-center'>
        <div className='flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-2xs'>
          <FileEdit className='size-7 stroke-[1.5]' />
        </div>
        <h3 className='mt-4 text-base font-semibold text-foreground'>
          No drafts yet
        </h3>
        <p className='mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground'>
          Drafts are personal scratchpad documents that you can start without assigning them to any project.
        </p>
        <Button
          size='sm'
          className='mt-6 text-xs gap-1.5'
          onClick={() => setCreateDialogOpen(true)}
        >
          <Plus className='size-3.5' />
          <span>Create First Draft</span>
        </Button>
      </div>

      <CreateDocDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        preselectedProjectId={null}
      />
    </>
  )
}
