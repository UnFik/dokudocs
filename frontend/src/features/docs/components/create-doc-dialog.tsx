import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import {
  Code2,
  Database,
  FileText,
  GitBranch,
  Plus,
  Tag,
  X,
} from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { DocType } from '@/types/dokudocs'
import { getCategoryPalette } from '@/lib/category-palette'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const createDocSchema = z.object({
  title: z.string().min(1, 'Please enter a document title'),
  type: z.enum(['markdown', 'dbdiagram', 'mermaid']),
  projectId: z.string(),
  categories: z.array(z.string()),
})

type CreateDocFormValues = z.infer<typeof createDocSchema>

interface CreateDocDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultType?: DocType
  defaultProjectId?: string | null
  defaultCategory?: string | null
  defaultCategories?: string[]
  preselectedProjectId?: string | null
}

export function CreateDocDialog({
  open,
  onOpenChange,
  defaultType = 'markdown',
  defaultProjectId = null,
  defaultCategory = null,
  defaultCategories,
  preselectedProjectId,
}: CreateDocDialogProps) {
  const navigate = useNavigate()
  const { projects, createDocument } = useDokudocsStore()
  const [customCategoryInput, setCustomCategoryInput] = useState('')

  const initialProjectId =
    preselectedProjectId !== undefined
      ? preselectedProjectId === null
        ? 'unassigned'
        : preselectedProjectId
      : defaultProjectId ?? (projects[0]?.id || 'unassigned')

  const initialCategories = defaultCategories?.length
    ? defaultCategories
    : defaultCategory
      ? [defaultCategory]
      : []

  const form = useForm<CreateDocFormValues>({
    resolver: zodResolver(createDocSchema),
    defaultValues: {
      title: '',
      type: defaultType,
      projectId: initialProjectId,
      categories: initialCategories,
    },
  })

  useEffect(() => {
    if (open) {
      const activeProjId =
        preselectedProjectId !== undefined
          ? preselectedProjectId === null
            ? 'unassigned'
            : preselectedProjectId
          : defaultProjectId ?? (projects[0]?.id || 'unassigned')

      const initialCats = defaultCategories?.length
        ? defaultCategories
        : defaultCategory
          ? [defaultCategory]
          : []

      form.reset({
        title: '',
        type: defaultType,
        projectId: activeProjId,
        categories: initialCats,
      })
      setCustomCategoryInput('')
    }
  }, [open, defaultType, defaultProjectId, defaultCategory, defaultCategories, preselectedProjectId, projects, form])

  const selectedProjectId = form.watch('projectId')
  const activeProject = projects.find((p) => p.id === selectedProjectId)
  const availableProjectCategories = activeProject?.categories ?? []
  const selectedCategories = form.watch('categories') || []

  const allVisibleCategories = Array.from(
    new Set([...availableProjectCategories, ...selectedCategories])
  )

  const handleToggleCategory = (cat: string) => {
    const current = form.getValues('categories') || []
    if (current.includes(cat)) {
      form.setValue(
        'categories',
        current.filter((c) => c !== cat)
      )
    } else {
      form.setValue('categories', [...current, cat])
    }
  }

  const handleAddCustomCategory = () => {
    const trimmed = customCategoryInput.trim()
    if (!trimmed) return
    const current = form.getValues('categories') || []
    if (!current.includes(trimmed)) {
      form.setValue('categories', [...current, trimmed])
    }
    setCustomCategoryInput('')
  }

  const onSubmit = (values: CreateDocFormValues) => {
    const assignedProjectId =
      values.projectId === 'unassigned' ? null : values.projectId

    const newDoc = createDocument({
      title: values.title.trim(),
      type: values.type,
      projectId: assignedProjectId,
      categories: values.categories,
      isDraft: !assignedProjectId,
    })

    toast.success(`Created "${newDoc.title}"`)
    onOpenChange(false)

    navigate({
      to: '/docs/$docId',
      params: { docId: newDoc.id },
    })
  }

  const typeOptions = [
    {
      value: 'markdown',
      label: 'Markdown',
      description: 'Functional specs & technical docs',
      icon: FileText,
    },
    {
      value: 'dbdiagram',
      label: 'Database Diagram',
      description: 'DBML schema definitions & ERD',
      icon: Database,
    },
    {
      value: 'mermaid',
      label: 'Architecture / Flow',
      description: 'Sequence diagrams & system graphs',
      icon: GitBranch,
    },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[540px] max-h-[90vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle className='text-lg font-bold flex items-center gap-2'>
            <Code2 className='size-5 text-primary' />
            Create Document
          </DialogTitle>
          <DialogDescription className='text-xs text-muted-foreground'>
            Choose document type, target project, and assign optional category tags.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4 pt-1'>
            <FormField
              control={form.control}
              name='title'
              render={({ field }) => (
                <FormItem>
                  <FormLabel className='text-xs font-semibold'>
                    Document Title <span className='text-destructive'>*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder='e.g. Order Processing'
                      className='h-9 text-xs'
                      autoFocus
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='type'
              render={({ field }) => (
                <FormItem>
                  <FormLabel className='text-xs font-semibold'>
                    Document Type
                  </FormLabel>
                  <div className='grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1'>
                    {typeOptions.map((opt) => {
                      const Icon = opt.icon
                      const isSelected = field.value === opt.value
                      return (
                        <button
                          key={opt.value}
                          type='button'
                          onClick={() => field.onChange(opt.value)}
                          className={`flex flex-col items-start p-3 rounded-lg border text-left transition-all cursor-pointer ${isSelected
                              ? 'border-primary bg-primary/5 ring-1 ring-primary'
                              : 'border-border/80 hover:bg-muted/40 hover:border-border'
                            }`}
                        >
                          <div className='flex items-center gap-2 mb-1.5'>
                            <div
                              className={`p-1.5 rounded-md ${isSelected
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-muted text-muted-foreground'
                                }`}
                            >
                              <Icon className='size-3.5' />
                            </div>
                            <span className='text-xs font-semibold'>
                              {opt.label}
                            </span>
                          </div>
                          <span className='text-[10px] text-muted-foreground line-clamp-2 leading-relaxed'>
                            {opt.description}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className='space-y-3 pt-1'>
              <FormField
                control={form.control}
                name='projectId'
                render={({ field }) => (
                  <FormItem className='w-full'>
                    <FormLabel className='text-xs font-semibold'>
                      Project Assignment
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={
                        preselectedProjectId !== undefined &&
                        preselectedProjectId !== null
                      }
                    >
                      <FormControl>
                        <SelectTrigger className='h-9 text-xs w-full'>
                          <SelectValue placeholder='Select target project' />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value='unassigned'>
                          Drafts (Personal / Unassigned)
                        </SelectItem>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className='space-y-2'>
                <FormLabel className='text-xs font-semibold flex items-center justify-between'>
                  <span>Categories (Multiple)</span>
                  <span className='text-[10px] text-muted-foreground font-normal'>
                    {selectedCategories.length} selected
                  </span>
                </FormLabel>

                {selectedProjectId === 'unassigned' ? (
                  <p className='text-xs text-muted-foreground italic py-1'>
                    Categories are available when assigned to a project.
                  </p>
                ) : (
                  <div className='space-y-2.5'>
                    {allVisibleCategories.length > 0 && (
                      <div className='flex flex-wrap gap-1.5 p-2 rounded-lg border border-border/60 bg-muted/20 min-h-10'>
                        {allVisibleCategories.map((c) => {
                          const isSelected = selectedCategories.includes(c)
                          const colorId = activeProject?.categoryColors?.[c]
                          const palette = getCategoryPalette(c, colorId)

                          return (
                            <button
                              key={c}
                              type='button'
                              onClick={() => handleToggleCategory(c)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer ${isSelected
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
                    )}

                    <div className='flex items-center gap-2'>
                      <Input
                        placeholder='Add new category tag...'
                        className='h-8 text-xs flex-1'
                        value={customCategoryInput}
                        onChange={(e) => setCustomCategoryInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleAddCustomCategory()
                          }
                        }}
                      />
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        onClick={handleAddCustomCategory}
                        disabled={!customCategoryInput.trim()}
                        className='h-8 px-2.5 text-xs gap-1 shrink-0'
                      >
                        <Plus className='size-3.5' />
                        <span>Add</span>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className='pt-2 flex items-center justify-end gap-2'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='text-xs h-8'
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type='submit' size='sm' className='text-xs h-8 px-4'>
                Create Document
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
