import { useState } from 'react'
import { AlertCircle, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useDokudocsStore } from '@/stores/dokudocs-store'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TrashEmptyState } from './components/trash-empty-state'
import { TrashTable } from './components/trash-table'

export function TrashPage() {
  const { trash, emptyTrash } = useDokudocsStore()
  const [emptyDialogOpen, setEmptyDialogOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const filteredTrash = trash.filter(
    (item) =>
      item.document.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.document.projectName?.toLowerCase() || '').includes(
        searchQuery.toLowerCase()
      )
  )

  const handleConfirmEmpty = () => {
    emptyTrash()
    toast.success('Trash emptied successfully')
    setEmptyDialogOpen(false)
  }

  return (
    <div className='flex flex-1 flex-col gap-6 p-6'>
      <div className='flex flex-col justify-between gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-center'>
        <div>
          <div className='flex items-center gap-2.5'>
            <div className='flex size-8 items-center justify-center rounded-lg bg-destructive/10 text-destructive'>
              <Trash2 className='size-4' />
            </div>
            <h1 className='text-xl font-bold tracking-tight text-foreground'>
              Trash
            </h1>
            <span className='rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground'>
              {trash.length}
            </span>
          </div>
          <p className='mt-1 text-xs text-muted-foreground'>
            Items in trash will be permanently deleted automatically after 30
            days.
          </p>
        </div>

        {trash.length > 0 && (
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setEmptyDialogOpen(true)}
              className='hover:text-destructive-foreground h-8 gap-1.5 border-destructive/30 text-xs text-destructive transition-colors hover:border-destructive hover:bg-destructive'
            >
              <Trash2 className='size-3.5' />
              <span>Empty Trash</span>
            </Button>
          </div>
        )}
      </div>

      {trash.length > 0 && (
        <div className='flex items-center justify-between gap-4'>
          <div className='relative w-full max-w-sm'>
            <Search className='absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground' />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder='Search deleted documents...'
              className='h-8 pl-8 text-xs'
            />
          </div>
          <div className='flex items-center gap-1.5 text-[11px] text-muted-foreground'>
            <AlertCircle className='size-3.5 text-muted-foreground/80' />
            <span>Restore files to resume editing</span>
          </div>
        </div>
      )}

      {trash.length === 0 ? (
        <TrashEmptyState />
      ) : filteredTrash.length === 0 ? (
        <div className='flex min-h-[30vh] flex-col items-center justify-center rounded-xl border border-dashed border-border/80 p-8 text-center'>
          <p className='text-xs text-muted-foreground'>
            No trash items matching &ldquo;{searchQuery}&rdquo;
          </p>
        </div>
      ) : (
        <TrashTable items={filteredTrash} />
      )}

      <AlertDialog open={emptyDialogOpen} onOpenChange={setEmptyDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className='flex items-center gap-2 text-destructive'>
              <Trash2 className='size-4' />
              Empty Entire Trash?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete all {trash.length}{' '}
              items in the trash? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmEmpty}
              className='text-destructive-foreground bg-destructive hover:bg-destructive/90'
            >
              Empty Trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
