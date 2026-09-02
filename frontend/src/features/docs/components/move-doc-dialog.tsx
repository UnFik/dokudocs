import { useEffect, useState } from 'react'
import { DocumentItem } from '@/types/dokudocs'
import { Check, FileEdit, Folder, FolderInput, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useDokudocsStore } from '@/stores/dokudocs-store'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { ConfirmDialog } from '@/components/confirm-dialog'

interface MoveDocDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: DocumentItem
}

export function MoveDocDialog({
  open,
  onOpenChange,
  document,
}: MoveDocDialogProps) {
  const { projects, activeOrgId, moveDocumentToProject } = useDokudocsStore()
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    document.projectId || null
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    if (open) {
      setSelectedProjectId(document.projectId || null)
      setSearchQuery('')
      setConfirmOpen(false)
    }
  }, [open, document])

  const availableProjects = (projects || []).filter(
    (p) => p.orgId === activeOrgId
  )

  const filteredProjects = availableProjects.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const currentProject = projects.find((p) => p.id === document.projectId)
  const targetProject = projects.find((p) => p.id === selectedProjectId)

  const executeMove = (targetId: string | null) => {
    moveDocumentToProject(document.id, targetId)
    if (targetId) {
      const targetProj = projects.find((p) => p.id === targetId)
      toast.success(
        `Moved "${document.title}" to project "${targetProj?.name || 'Project'}"`
      )
    } else {
      toast.success(`Moved "${document.title}" to Drafts`)
    }
    setConfirmOpen(false)
    onOpenChange(false)
  }

  const handleConfirm = () => {
    if (document.projectId && selectedProjectId !== document.projectId) {
      setConfirmOpen(true)
      return
    }
    executeMove(selectedProjectId)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <div className='flex items-center gap-2'>
              <div className='flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary'>
                <FolderInput className='size-4' />
              </div>
              <div>
                <DialogTitle className='text-base font-semibold'>
                  Move to Project
                </DialogTitle>
                <DialogDescription className='text-xs'>
                  Assign{' '}
                  <span className='font-medium text-foreground'>
                    &ldquo;{document.title}&rdquo;
                  </span>{' '}
                  to a project.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className='space-y-3 py-2'>
            <div className='relative'>
              <Search className='absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground' />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder='Search project...'
                className='h-8 pl-8 text-xs'
                autoFocus
              />
            </div>

            <ScrollArea className='h-60 rounded-md border border-border/80 p-1.5'>
              <div className='space-y-1'>
                <button
                  type='button'
                  onClick={() => setSelectedProjectId(null)}
                  className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors ${
                    selectedProjectId === null
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-foreground hover:bg-muted'
                  }`}
                >
                  <div className='flex items-center gap-2.5 truncate'>
                    <div className='flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground'>
                      <FileEdit className='size-3.5' />
                    </div>
                    <div className='truncate text-left'>
                      <p className='truncate font-medium'>
                        Drafts (No Project)
                      </p>
                      <p className='text-[10px] text-muted-foreground'>
                        Keep as an unassigned draft
                      </p>
                    </div>
                  </div>
                  {selectedProjectId === null && (
                    <Check className='size-4 shrink-0' />
                  )}
                </button>

                {filteredProjects.map((proj) => {
                  const isSelected = selectedProjectId === proj.id
                  return (
                    <button
                      key={proj.id}
                      type='button'
                      onClick={() => setSelectedProjectId(proj.id)}
                      className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors ${
                        isSelected
                          ? 'bg-primary/10 font-medium text-primary'
                          : 'text-foreground hover:bg-muted'
                      }`}
                    >
                      <div className='flex items-center gap-2.5 truncate'>
                        {proj.logoUrl ? (
                          <img
                            src={proj.logoUrl}
                            alt={proj.name}
                            className='size-7 rounded-md border border-border/80 object-cover'
                          />
                        ) : (
                          <div className='flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary'>
                            <Folder className='size-3.5' />
                          </div>
                        )}
                        <div className='truncate text-left'>
                          <p className='truncate font-medium'>{proj.name}</p>
                          <p className='text-[10px] text-muted-foreground'>
                            {proj.documentIds.length} documents
                          </p>
                        </div>
                      </div>
                      {isSelected && <Check className='size-4 shrink-0' />}
                    </button>
                  )
                })}

                {filteredProjects.length === 0 && searchQuery && (
                  <div className='py-6 text-center text-xs text-muted-foreground'>
                    No projects matching &ldquo;{searchQuery}&rdquo;
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          <DialogFooter className='gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => onOpenChange(false)}
              className='h-8 text-xs'
            >
              Cancel
            </Button>
            <Button
              type='button'
              size='sm'
              onClick={handleConfirm}
              className='h-8 text-xs'
            >
              Move Document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title='Move document to another project?'
        desc={
          <span>
            This document currently belongs to{' '}
            <strong>&ldquo;{currentProject?.name}&rdquo;</strong>. Moving it to{' '}
            {selectedProjectId ? (
              <strong>&ldquo;{targetProject?.name}&rdquo;</strong>
            ) : (
              'Drafts'
            )}{' '}
            will transfer its ownership. Are you sure you want to continue?
          </span>
        }
        confirmText='Yes, Move Document'
        handleConfirm={() => executeMove(selectedProjectId)}
      />
    </>
  )
}
