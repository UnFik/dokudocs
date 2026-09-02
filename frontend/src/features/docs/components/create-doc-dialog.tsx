import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { DocType } from '@/types/dokudocs'
import {
  Code2,
  Database,
  FileText,
  GitBranch,
  Plus,
  Tag,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { getCategoryPalette } from '@/lib/category-palette'
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
      : (defaultProjectId ?? (projects[0]?.id || 'unassigned'))

  const initialCategories = defaultCategories?.length
    ? defaultCategories
    : defaultCategory
      ? [defaultCategory]
      : []

  const form = useForm<CreateDocFormValues>({
    resolver: zodResolver(createDocSchema),
    defaultValues: {
      title: 'My Draft',
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
          : (defaultProjectId ?? (projects[0]?.id || 'unassigned'))

      const initialCats = defaultCategories?.length
        ? defaultCategories
        : defaultCategory
          ? [defaultCategory]
          : []

      form.reset({
        title: 'My Draft',
        type: defaultType,
        projectId: activeProjId,
        categories: initialCats,
      })
      setCustomCategoryInput('')
    }
  }, [
    open,
    defaultType,
    defaultProjectId,
    defaultCategory,
    defaultCategories,
    preselectedProjectId,
    projects,
    form,
  ])

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
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-[540px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2 text-lg font-bold'>
            <Code2 className='size-5 text-primary' />
            Create Document
          </DialogTitle>
          <DialogDescription className='text-xs text-muted-foreground'>
            Choose document type, target project, and assign optional category
            tags.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className='space-y-4 pt-1'
          >
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
                  <div className='grid grid-cols-1 gap-2.5 pt-1 sm:grid-cols-3'>
                    {typeOptions.map((opt) => {
                      const Icon = opt.icon
                      const isSelected = field.value === opt.value
                      return (
                        <button
                          key={opt.value}
                          type='button'
                          onClick={() => field.onChange(opt.value)}
                          className={`flex cursor-pointer flex-col items-start rounded-lg border p-3 text-left transition-all ${
                            isSelected
                              ? 'border-primary bg-primary/5 ring-1 ring-primary'
                              : 'border-border/80 hover:border-border hover:bg-muted/40'
                          }`}
                        >
                          <div className='mb-1.5 flex items-center gap-2'>
                            <div
                              className={`rounded-md p-1.5 ${
                                isSelected
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
                          <span className='line-clamp-2 text-[10px] leading-relaxed text-muted-foreground'>
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
                        <SelectTrigger className='h-9 w-full text-xs'>
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
                <FormLabel className='flex items-center justify-between text-xs font-semibold'>
                  <span>Categories (Multiple)</span>
                  <span className='text-[10px] font-normal text-muted-foreground'>
                    {selectedCategories.length} selected
                  </span>
                </FormLabel>

                {selectedProjectId === 'unassigned' ? (
                  <p className='py-1 text-xs text-muted-foreground italic'>
                    Categories are available when assigned to a project.
                  </p>
                ) : (
                  <div className='space-y-2.5'>
                    {allVisibleCategories.length > 0 && (
                      <div className='flex min-h-10 flex-wrap gap-1.5 rounded-lg border border-border/60 bg-muted/20 p-2'>
                        {allVisibleCategories.map((c) => {
                          const isSelected = selectedCategories.includes(c)
                          const colorId = activeProject?.categoryColors?.[c]
                          const palette = getCategoryPalette(c, colorId)

                          return (
                            <button
                              key={c}
                              type='button'
                              onClick={() => handleToggleCategory(c)}
                              className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
                                isSelected
                                  ? `${palette.bg} ${palette.text} ${palette.border} shadow-2xs ring-1 ring-primary/40`
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
                    )}

                    <div className='flex items-center gap-2'>
                      <Input
                        placeholder='Add new category tag...'
                        className='h-8 flex-1 text-xs'
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
                        className='h-8 shrink-0 gap-1 px-2.5 text-xs'
                      >
                        <Plus className='size-3.5' />
                        <span>Add</span>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className='flex items-center justify-end gap-2 pt-2'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='h-8 text-xs'
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type='submit' size='sm' className='h-8 px-4 text-xs'>
                Create Document
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
