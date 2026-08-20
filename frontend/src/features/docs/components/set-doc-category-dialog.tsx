import { useEffect, useState } from 'react'
import { Plus, Tag, X } from 'lucide-react'
import { toast } from 'sonner'
import { DocumentItem } from '@/types/dokudocs'
import { getCategoryPalette } from '@/lib/category-palette'
import { getDocCategories } from '@/lib/doc-category-utils'
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
import { Label } from '@/components/ui/label'

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
  const { projects, updateDocument, addProjectCategory } = useDokudocsStore()
  const project = projects.find((p) => p.id === document.projectId)
  const availableCategories = project?.categories ?? []

  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [customInput, setCustomInput] = useState('')

  useEffect(() => {
    if (open) {
      setSelectedCategories(getDocCategories(document))
      setCustomInput('')
    } else {
      window.document.body.style.pointerEvents = ''
    }
  }, [open, document])

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
      addProjectCategory(document.projectId, trimmed)
    }
    setCustomInput('')
  }

  const handleSave = () => {
    updateDocument(document.id, {
      categories: selectedCategories,
      category: selectedCategories[0] ?? null,
    })

    toast.success(
      selectedCategories.length > 0
        ? `Updated categories (${selectedCategories.length})`
        : 'Categories cleared'
    )
    onOpenChange(false)
    window.document.body.style.pointerEvents = ''
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
              <div className='flex flex-wrap gap-1.5 p-2.5 rounded-lg border border-border/60 bg-muted/20 min-h-12'>
                {allVisibleCategories.map((c) => {
                  const isSelected = selectedCategories.includes(c)
                  const colorId = project?.categoryColors?.[c]
                  const palette = getCategoryPalette(c, colorId)

                  return (
                    <button
                      key={c}
                      type='button'
                      onClick={() => handleToggle(c)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer ${
                        isSelected
                          ? `${palette.bg} ${palette.text} ${palette.border} ring-1 ring-primary/40 shadow-2xs`
                          : 'bg-background text-muted-foreground border-border/80 hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      <Tag className='size-2.5' />
                      <span>{c}</span>
                      {isSelected && <X className='size-2.5 ml-0.5' />}
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
                className='h-9 px-3 text-xs gap-1 shrink-0'
              >
                <Plus className='size-3.5' />
                <span>Add</span>
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className='flex items-center justify-between sm:justify-between gap-2 pt-2'>
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
