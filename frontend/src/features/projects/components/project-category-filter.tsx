import { useRef, useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Pencil,
  Plus,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import {
  CATEGORY_COLOR_OPTIONS,
  getCategoryPalette,
} from '@/lib/category-palette'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { EditCategoryDialog } from './edit-category-dialog'

const addCategorySchema = z.object({
  categoryName: z
    .string()
    .min(1, 'Category name required')
    .max(30, 'Category name too long'),
  colorId: z.string(),
})

type AddCategoryFormValues = z.infer<typeof addCategorySchema>

interface ProjectCategoryFilterProps {
  projectId: string
  categories: string[]
  selectedCategories: string[]
  onToggleCategory: (category: string) => void
  onClearCategories: () => void
  docCountsByCategory: Record<string, number>
  totalDocsCount: number
}

export function ProjectCategoryFilter({
  projectId,
  categories = [],
  selectedCategories = [],
  onToggleCategory,
  onClearCategories,
  docCountsByCategory,
  totalDocsCount,
}: ProjectCategoryFilterProps) {
  const {
    projects,
    addProjectCategory,
    removeProjectCategory,
    reorderProjectCategories,
  } = useDokudocsStore()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [filterMode, setFilterMode] = useState<'normal' | 'edit' | 'delete'>(
    'normal'
  )
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const project = projects.find((p) => p.id === projectId)
  const categoryColors = project?.categoryColors ?? {}
  const safeCategories = categories ?? []

  const form = useForm<AddCategoryFormValues>({
    resolver: zodResolver(addCategorySchema),
    defaultValues: {
      categoryName: '',
      colorId: 'blue',
    },
  })

  const scroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const offset = direction === 'left' ? -200 : 200
      scrollContainerRef.current.scrollBy({ left: offset, behavior: 'smooth' })
    }
  }

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (filterMode !== 'edit') return
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
    setDraggedIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    if (filterMode !== 'edit' || draggedIndex === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIndex !== index) {
      setDragOverIndex(index)
    }
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault()
    if (
      filterMode !== 'edit' ||
      draggedIndex === null ||
      draggedIndex === targetIndex
    ) {
      setDraggedIndex(null)
      setDragOverIndex(null)
      return
    }

    const reordered = [...safeCategories]
    const [movedItem] = reordered.splice(draggedIndex, 1)
    reordered.splice(targetIndex, 0, movedItem)

    reorderProjectCategories(projectId, reordered)
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const onSubmit = (values: AddCategoryFormValues) => {
    const trimmed = values.categoryName.trim()
    if (safeCategories.includes(trimmed)) {
      toast.error('Category already exists in this project')
      return
    }

    addProjectCategory(projectId, trimmed, values.colorId)
    toast.success(`Category "${trimmed}" added`)
    form.reset({ categoryName: '', colorId: 'blue' })
    setPopoverOpen(false)
    onToggleCategory(trimmed)
  }

  const handleCategoryClick = (category: string) => {
    if (filterMode === 'edit') {
      setEditingCategory(category)
    } else if (filterMode === 'delete') {
      removeProjectCategory(projectId, category)
      if (selectedCategories.includes(category)) {
        onToggleCategory(category)
      }
      toast.success(`Category "${category}" deleted`)
    } else {
      onToggleCategory(category)
    }
  }

  const isAllSelected = selectedCategories.length === 0

  return (
    <>
      <div className='flex w-full flex-col justify-between gap-2.5 py-1 sm:flex-row sm:items-center'>
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          <div className='shrink-0'>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='outline'
                  size='sm'
                  className='h-8 gap-1.5 text-xs'
                >
                  <Tag className='size-3.5 text-muted-foreground' />
                  <span className='max-w-28 truncate'>
                    {isAllSelected
                      ? 'All Categories'
                      : selectedCategories.length === 1
                        ? selectedCategories[0]
                        : `${selectedCategories.length} Categories`}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='start' className='w-52'>
                <DropdownMenuItem
                  onClick={onClearCategories}
                  className='flex items-center justify-between'
                >
                  <span>All Categories ({totalDocsCount})</span>
                  {isAllSelected && <Check className='size-3.5' />}
                </DropdownMenuItem>
                {safeCategories.length > 0 && <DropdownMenuSeparator />}
                {safeCategories.map((cat, idx) => {
                  const colorId = categoryColors[cat]
                  const palette = getCategoryPalette(cat, colorId, idx)
                  const isChecked = selectedCategories.includes(cat)

                  return (
                    <DropdownMenuItem
                      key={cat}
                      onClick={() => onToggleCategory(cat)}
                      className='flex items-center justify-between'
                    >
                      <div className='flex items-center gap-2 truncate'>
                        <div className={`size-2 rounded-full ${palette.dot}`} />
                        <span className='truncate'>{cat}</span>
                      </div>
                      <div className='flex items-center gap-2'>
                        <span className='font-mono text-[10px] text-muted-foreground'>
                          {docCountsByCategory[cat] || 0}
                        </span>
                        {isChecked && <Check className='size-3.5' />}
                      </div>
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className='relative flex min-w-0 flex-1 items-center overflow-hidden'>
            <Button
              variant='ghost'
              size='icon'
              className='absolute left-0 z-10 size-6 rounded-full bg-background/90 shadow-xs backdrop-blur-xs'
              onClick={() => scroll('left')}
            >
              <ChevronLeft className='size-3.5' />
            </Button>

            <div
              ref={scrollContainerRef}
              className='flex scrollbar-none items-center gap-2 overflow-x-auto px-7 py-2'
            >
              <button
                type='button'
                onClick={onClearCategories}
                disabled={filterMode !== 'normal'}
                className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                  isAllSelected && filterMode === 'normal'
                    ? 'border-primary bg-primary text-primary-foreground shadow-2xs'
                    : 'border-border/60 bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <span>All</span>
                <span
                  className={`py-0.2 rounded-full px-1.5 text-[10px] font-semibold ${
                    isAllSelected && filterMode === 'normal'
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'bg-background/80 text-muted-foreground'
                  }`}
                >
                  {totalDocsCount}
                </span>
              </button>

              {safeCategories.map((category, index) => {
                const count = docCountsByCategory[category] || 0
                const isSelected =
                  selectedCategories.includes(category) &&
                  filterMode === 'normal'
                const isJiggling = filterMode !== 'normal'
                const isDragging = draggedIndex === index
                const isDragOver =
                  dragOverIndex === index && draggedIndex !== index
                const colorId = categoryColors[category]
                const palette = getCategoryPalette(category, colorId, index)

                const jiggleClass =
                  isJiggling && !isDragging
                    ? index % 2 === 0
                      ? 'animate-jiggle'
                      : 'animate-jiggle-alt'
                    : ''

                return (
                  <div
                    key={category}
                    draggable={filterMode === 'edit'}
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    onDrop={(e) => handleDrop(e, index)}
                    className={`relative flex shrink-0 items-center rounded-full border transition-all ${jiggleClass} ${
                      isDragging
                        ? 'ring-dashed scale-95 opacity-30 ring-2 ring-amber-500'
                        : isDragOver
                          ? 'scale-105 shadow-md ring-2 ring-amber-500 ring-offset-2'
                          : ''
                    } ${
                      filterMode === 'edit'
                        ? 'cursor-grab border-amber-500/40 bg-amber-500/10 py-1 pr-2.5 pl-2 text-amber-700 ring-2 ring-amber-500/80 select-none active:cursor-grabbing dark:text-amber-300'
                        : filterMode === 'delete'
                          ? 'cursor-pointer border-red-500/40 bg-red-500/10 py-1 pr-2 pl-3 text-red-700 ring-2 ring-red-500/80 dark:text-red-300'
                          : isSelected
                            ? `${palette.activeBg} ${palette.activeText} border-transparent px-3 py-1 shadow-2xs ring-1 ring-primary/40`
                            : `${palette.bg} ${palette.text} ${palette.border} px-3 py-1 hover:opacity-90`
                    }`}
                  >
                    <button
                      type='button'
                      onClick={() => handleCategoryClick(category)}
                      className='flex cursor-pointer items-center gap-1.5 text-xs font-medium'
                      title={
                        filterMode === 'edit'
                          ? `Drag to reorder, or click to edit "${category}"`
                          : isSelected
                            ? `Unselect "${category}"`
                            : `Filter by "${category}"`
                      }
                    >
                      {filterMode === 'edit' ? (
                        <div className='flex items-center gap-0.5'>
                          <GripVertical className='-ml-0.5 size-3 shrink-0 text-amber-600/70 dark:text-amber-400/70' />
                          <Pencil className='size-3 shrink-0 text-amber-600 dark:text-amber-400' />
                        </div>
                      ) : isSelected ? (
                        <Check className='size-3 shrink-0' />
                      ) : (
                        <div
                          className={`size-1.5 shrink-0 rounded-full ${palette.dot}`}
                        />
                      )}
                      <span>{category}</span>
                      <span
                        className={`py-0.2 rounded-full px-1.5 text-[10px] font-semibold ${
                          isSelected
                            ? 'bg-white/20 text-white'
                            : `${palette.badgeBg} ${palette.badgeText}`
                        }`}
                      >
                        {count}
                      </span>
                    </button>

                    {filterMode === 'delete' && (
                      <button
                        type='button'
                        onClick={(e) => {
                          e.stopPropagation()
                          handleCategoryClick(category)
                        }}
                        className='absolute -top-1.5 -right-1.5 z-20 flex size-5 items-center justify-center rounded-full bg-red-600 text-white shadow-sm transition-transform hover:scale-115 dark:bg-red-500'
                        title='Delete category'
                      >
                        <X className='size-3 stroke-[3] text-white' />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            <Button
              variant='ghost'
              size='icon'
              className='absolute right-0 z-10 size-6 rounded-full bg-background/90 shadow-xs backdrop-blur-xs'
              onClick={() => scroll('right')}
            >
              <ChevronRight className='size-3.5' />
            </Button>
          </div>
        </div>

        <div className='flex shrink-0 items-center gap-1.5 self-end sm:self-auto'>
          {filterMode !== 'normal' ? (
            <Button
              variant='default'
              size='sm'
              className='h-8 gap-1.5 px-3 text-xs font-semibold'
              onClick={() => setFilterMode('normal')}
            >
              <Check className='size-3.5' />
              <span>Done</span>
            </Button>
          ) : (
            <>
              <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant='outline'
                    size='sm'
                    className='h-8 gap-1.5 px-2.5 text-xs font-medium'
                  >
                    <Plus className='size-3.5' />
                    <span>Add Category</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align='end' className='w-72 p-3.5'>
                  <Form {...form}>
                    <form
                      onSubmit={form.handleSubmit(onSubmit)}
                      className='space-y-3.5'
                    >
                      <div className='space-y-1'>
                        <h4 className='text-xs font-semibold text-foreground'>
                          New Custom Category
                        </h4>
                        <p className='text-[10px] text-muted-foreground'>
                          Create a feature tag and choose its color palette.
                        </p>
                      </div>

                      <FormField
                        control={form.control}
                        name='categoryName'
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className='text-[11px]'>
                              Category Name
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder='e.g. Authentication, Checkout'
                                className='h-8 text-xs'
                                {...field}
                                autoFocus
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name='colorId'
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className='text-[11px]'>
                              Color Palette
                            </FormLabel>
                            <FormControl>
                              <div className='flex flex-wrap items-center gap-1.5 pt-0.5'>
                                {CATEGORY_COLOR_OPTIONS.map((opt) => {
                                  const isSelected = field.value === opt.id
                                  return (
                                    <button
                                      key={opt.id}
                                      type='button'
                                      onClick={() => field.onChange(opt.id)}
                                      className={`size-6 rounded-full ${opt.dot} flex items-center justify-center transition-all ${
                                        isSelected
                                          ? 'scale-110 shadow-xs ring-2 ring-primary ring-offset-2'
                                          : 'opacity-80 hover:scale-105 hover:opacity-100'
                                      }`}
                                      title={opt.name}
                                    >
                                      {isSelected && (
                                        <Check className='size-3 stroke-[3] text-white' />
                                      )}
                                    </button>
                                  )
                                })}
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className='flex justify-end gap-2 pt-1'>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          className='h-7 text-xs'
                          onClick={() => setPopoverOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button type='submit' size='sm' className='h-7 text-xs'>
                          Save
                        </Button>
                      </div>
                    </form>
                  </Form>
                </PopoverContent>
              </Popover>

              <Button
                variant='outline'
                size='sm'
                className='h-8 gap-1.5 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground'
                onClick={() => setFilterMode('edit')}
                disabled={safeCategories.length === 0}
              >
                <Pencil className='size-3.5' />
                <span>Edit</span>
              </Button>

              <Button
                variant='outline'
                size='sm'
                className='h-8 gap-1.5 px-2.5 text-xs font-medium text-muted-foreground hover:text-destructive'
                onClick={() => setFilterMode('delete')}
                disabled={safeCategories.length === 0}
              >
                <Trash2 className='size-3.5' />
                <span>Delete</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {editingCategory && (
        <EditCategoryDialog
          open={!!editingCategory}
          onOpenChange={(open) => {
            if (!open) setEditingCategory(null)
          }}
          projectId={projectId}
          categoryName={editingCategory}
          currentColorId={categoryColors[editingCategory]}
        />
      )}
    </>
  )
}
