import { useEffect, useState } from 'react'
import { type DocumentItem } from '@/types/dokudocs'
import { Plus, Tag, X } from 'lucide-react'
import { getCategoryPalette } from '@/lib/category-palette'
import { getDocCategories } from '@/lib/doc-category-utils'
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
import { useDokudocs } from '@/features/dashboard/hooks/use-dokudocs'
import {
  useAddProjectCategory,
  useUpdateDocument,
} from '../hooks/use-document-actions'

interface SetDocCategoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: DocumentItem
}

export function SetDocCategoryDialog({
  open,
  onOpenChange,
  document,
}: SetDocCategoryDialogProps) {
  const { projects } = useDokudocs()
  const updateDocument = useUpdateDocument()
  const addProjectCategory = useAddProjectCategory()
  const project = projects.find((p) => p.id === document.projectId)
  const availableCategories = project?.categories ?? []

  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [customInput, setCustomInput] = useState('')

  // Reset the form each time the dialog opens. Doing it during render avoids a frame with stale values.
  const [syncedWith, setSyncedWith] = useState({ open, document })
  if (syncedWith.open !== open || syncedWith.document !== document) {
    setSyncedWith({ open, document })
    if (open) {
      setSelectedCategories(getDocCategories(document))
      setCustomInput('')
    }
  }

  useEffect(() => {
    if (!open) window.document.body.style.pointerEvents = ''
  }, [open])

  const allVisibleCategories = Array.from(
    new Set([...availableCategories, ...selectedCategories])
  )

  const handleToggle = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    )
  }

  const handleAddCustom = () => {
    const trimmed = customInput.trim()
    if (!trimmed) return
    if (!selectedCategories.includes(trimmed)) {
      setSelectedCategories((prev) => [...prev, trimmed])
    }
    if (document.projectId) {
      addProjectCategory.mutate({
        workspaceId: document.orgId,
        projectId: document.projectId,
        name: trimmed,
      })
    }
    setCustomInput('')
  }

  const handleSave = () => {
    updateDocument.mutate(
      {
        document,
        input: { categories: selectedCategories },
        message:
          selectedCategories.length > 0
            ? `Updated categories (${selectedCategories.length})`
            : 'Categories cleared',
      },
      {
        onSuccess: () => {
          onOpenChange(false)
          window.document.body.style.pointerEvents = ''
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <div className='flex items-center gap-2 text-primary'>
            <Tag className='size-5' />
            <DialogTitle>Set Document Categories</DialogTitle>
          </div>
          <DialogDescription>
            Assign one or more categories for &ldquo;{document.title}&rdquo;.
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-4 py-3'>
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <Label className='text-xs font-semibold'>Categories</Label>
              <span className='text-[10px] text-muted-foreground'>
                {selectedCategories.length} selected
              </span>
            </div>

            {allVisibleCategories.length > 0 ? (
              <div className='flex min-h-12 flex-wrap gap-1.5 rounded-lg border border-border/60 bg-muted/20 p-2.5'>
                {allVisibleCategories.map((c) => {
                  const isSelected = selectedCategories.includes(c)
                  const colorId = project?.categoryColors?.[c]
                  const palette = getCategoryPalette(c, colorId)

                  return (
                    <button
                      key={c}
                      type='button'
                      onClick={() => handleToggle(c)}
                      className={`inline-flex cursor-pointer items-center gap-1 rounded-sm border px-2.5 py-1 text-xs font-medium transition-all ${
                        isSelected
                          ? `${palette.bg} ${palette.text} ${palette.border} ring-1 ring-primary/40`
                          : 'border-border/80 bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      <Tag className='size-2.5' />
                      <span>{c}</span>
                      {isSelected && <X className='ml-0.5 size-2.5' />}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className='text-xs text-muted-foreground italic'>
                No project categories yet. Add one below.
              </p>
            )}
          </div>

          <div className='space-y-1.5'>
            <Label className='text-xs font-semibold'>Add New Category</Label>
            <div className='flex items-center gap-2'>
              <Input
                placeholder='e.g. Authentication, Checkout, API'
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddCustom()
                  }
                }}
                className='h-9 text-xs'
              />
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={handleAddCustom}
                disabled={!customInput.trim()}
                className='h-9 shrink-0 gap-1 px-3 text-xs'
              >
                <Plus className='size-3.5' />
                <span>Add</span>
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className='flex items-center justify-between gap-2 pt-2 sm:justify-between'>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => setSelectedCategories([])}
            className='text-xs text-muted-foreground hover:text-destructive'
            disabled={selectedCategories.length === 0}
          >
            Clear All
          </Button>
          <div className='flex items-center gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type='button' size='sm' onClick={handleSave}>
              Save Categories
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
