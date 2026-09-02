import { useState } from 'react'
import { TrashItem } from '@/types/dokudocs'
import { Folder, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { getCategoryPalette } from '@/lib/category-palette'
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DocTypeBadge } from '@/features/docs/components/doc-type-badge'

interface TrashTableProps {
  items: TrashItem[]
}

export function TrashTable({ items }: TrashTableProps) {
  const { restoreFromTrash, permanentDeleteFromTrash, projects } =
    useDokudocsStore()
  const [deleteTarget, setDeleteTarget] = useState<TrashItem | null>(null)

  const handleRestore = (item: TrashItem) => {
    restoreFromTrash(item.id)
    toast.success(`"${item.document.title}" restored successfully`)
  }

  const handleConfirmPermanentDelete = () => {
    if (!deleteTarget) return
    permanentDeleteFromTrash(deleteTarget.id)
    toast.success(`"${deleteTarget.document.title}" deleted permanently`)
    setDeleteTarget(null)
  }

  return (
    <>
      <div className='overflow-hidden rounded-xl border border-border/80 bg-card shadow-2xs'>
        <Table>
          <TableHeader>
            <TableRow className='bg-muted/40 hover:bg-muted/40'>
              <TableHead className='w-[380px] text-xs font-semibold text-foreground'>
                Document Title
              </TableHead>
              <TableHead className='text-xs font-semibold text-foreground'>
                Original Project
              </TableHead>
              <TableHead className='text-xs font-semibold text-foreground'>
                Deleted By / At
              </TableHead>
              <TableHead className='text-xs font-semibold text-foreground'>
                Remaining
              </TableHead>
              <TableHead className='w-[140px] text-right text-xs font-semibold text-foreground'>
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const project = projects.find(
                (p) => p.id === item.document.projectId
              )
              const category = item.document.category
              const colorId = category
                ? project?.categoryColors?.[category]
                : undefined
              const categoryPalette = category
                ? getCategoryPalette(category, colorId)
                : null

              return (
                <TableRow key={item.id} className='transition-colors'>
                  <TableCell className='font-medium'>
                    <div className='flex items-center gap-2.5'>
                      <DocTypeBadge
                        type={item.document.type}
                        showIcon={false}
                      />
                      <div className='flex min-w-0 flex-col'>
                        <span className='truncate text-xs font-semibold text-foreground'>
                          {item.document.title}
                        </span>
                        {category && categoryPalette && (
                          <span
                            className={`py-0.2 mt-1 inline-flex w-fit rounded-full border px-1.5 text-[9px] font-medium ${categoryPalette.bg} ${categoryPalette.text} ${categoryPalette.border}`}
                          >
                            {category}
                          </span>
                        )}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    {item.document.projectName ? (
                      <div className='flex items-center gap-1.5 text-xs text-muted-foreground'>
                        <Folder className='size-3.5 shrink-0 text-muted-foreground/70' />
                        <span className='max-w-40 truncate'>
                          {item.document.projectName}
                        </span>
                      </div>
                    ) : (
                      <span className='text-xs text-muted-foreground/60 italic'>
                        Draft (Unassigned)
                      </span>
                    )}
                  </TableCell>

                  <TableCell>
                    <div className='flex items-center gap-2'>
                      <Avatar className='size-5 shrink-0'>
                        <AvatarImage
                          src={item.deletedBy.avatar}
                          alt={item.deletedBy.name}
                        />
                        <AvatarFallback className='text-[9px]'>
                          {item.deletedBy.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className='flex flex-col text-xs'>
                        <span className='text-[11px] font-medium text-foreground/90'>
                          {item.deletedBy.name}
                        </span>
                        <span className='text-[10px] text-muted-foreground'>
                          {item.deletedAt}
                        </span>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    <span className='inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400'>
                      {item.daysRemaining} days left
                    </span>
                  </TableCell>

                  <TableCell className='text-right'>
                    <div className='flex items-center justify-end gap-1.5'>
                      <Button
                        variant='outline'
                        size='icon'
                        className='size-7 text-muted-foreground hover:bg-muted hover:text-foreground'
                        onClick={() => handleRestore(item)}
                        title='Restore Document'
                      >
                        <RotateCcw className='size-3.5' />
                      </Button>
                      <Button
                        variant='ghost'
                        size='icon'
                        className='size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
                        onClick={() => setDeleteTarget(item)}
                        title='Delete Permanently'
                      >
                        <Trash2 className='size-3.5' />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className='flex items-center gap-2 text-destructive'>
              <Trash2 className='size-4' />
              Delete Document Permanently
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete &ldquo;
              {deleteTarget?.document.title}&rdquo;? This action cannot be
              undone and all content will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmPermanentDelete}
              className='text-destructive-foreground bg-destructive hover:bg-destructive/90'
            >
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
