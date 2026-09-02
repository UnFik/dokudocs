import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import {
  Check,
  Database,
  FileCode,
  FileText,
  GitBranch,
  Plus,
  Sparkles,
  Tag,
  Upload,
  UploadCloud,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { getCategoryPalette } from '@/lib/category-palette'
import {
  detectDocTypeAndContent,
  parseProperCaseTitle,
} from '@/lib/doc-import-utils'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const importDocSchema = z.object({
  title: z.string().min(1, 'Please enter a document title'),
  type: z.enum(['markdown', 'dbdiagram', 'mermaid']),
  projectId: z.string(),
  categories: z.array(z.string()),
  content: z.string(),
})

type ImportDocFormValues = z.infer<typeof importDocSchema>

interface ImportDocDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  preselectedProjectId?: string | null
}

export function ImportDocDialog({
  open,
  onOpenChange,
  preselectedProjectId,
}: ImportDocDialogProps) {
  const navigate = useNavigate()
  const { projects, createDocument } = useDokudocsStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [isDragging, setIsDragging] = useState(false)
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const [fileSize, setFileSize] = useState<number | null>(null)
  const [detectedReason, setDetectedReason] = useState<string | null>(null)
  const [customCategoryInput, setCustomCategoryInput] = useState('')

  const initialProjectId =
    preselectedProjectId !== undefined
      ? preselectedProjectId === null
        ? 'unassigned'
        : preselectedProjectId
      : projects[0]?.id || 'unassigned'

  const form = useForm<ImportDocFormValues>({
    resolver: zodResolver(importDocSchema),
    defaultValues: {
      title: '',
      type: 'markdown',
      projectId: initialProjectId,
      categories: [],
      content: '',
    },
  })

  useEffect(() => {
    if (open) {
      const activeProjId =
        preselectedProjectId !== undefined
          ? preselectedProjectId === null
            ? 'unassigned'
            : preselectedProjectId
          : projects[0]?.id || 'unassigned'

      form.reset({
        title: '',
        type: 'markdown',
        projectId: activeProjId,
        categories: [],
        content: '',
      })
      setSelectedFileName(null)
      setFileSize(null)
      setDetectedReason(null)
      setCustomCategoryInput('')
      setIsDragging(false)
    }
  }, [open, preselectedProjectId, projects, form])

  const selectedProjectId = form.watch('projectId')
  const activeProject = projects.find((p) => p.id === selectedProjectId)
  const availableProjectCategories = activeProject?.categories ?? []
  const selectedCategories = form.watch('categories') || []
  const currentContent = form.watch('content') || ''

  const allVisibleCategories = Array.from(
    new Set([...availableProjectCategories, ...selectedCategories])
  )

  const processFile = async (file: File) => {
    try {
      const text = await file.text()
      const properTitle = parseProperCaseTitle(file.name)
      const {
        type,
        content,
        detectedReason: reason,
      } = detectDocTypeAndContent(file.name, text)

      setSelectedFileName(file.name)
      setFileSize(file.size)
      setDetectedReason(reason)

      form.setValue('title', properTitle, { shouldValidate: true })
      form.setValue('type', type, { shouldValidate: true })
      form.setValue('content', content, { shouldValidate: true })
    } catch {
      toast.error('Failed to read file content')
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0])
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0])
    }
  }

  const handleResetFile = () => {
    setSelectedFileName(null)
    setFileSize(null)
    setDetectedReason(null)
    form.setValue('title', '')
    form.setValue('content', '')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

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

  const onSubmit = (values: ImportDocFormValues) => {
    const assignedProjectId =
      values.projectId === 'unassigned' ? null : values.projectId

    const newDoc = createDocument({
      title: values.title.trim(),
      type: values.type,
      projectId: assignedProjectId,
      categories: values.categories,
      content: values.content,
      isDraft: !assignedProjectId,
    })

    toast.success(`Imported "${newDoc.title}" successfully`)
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
      description: 'Functional specs & documentation',
      icon: FileText,
    },
    {
      value: 'dbdiagram',
      label: 'Database Diagram',
      description: 'DBML schema & entity relationships',
      icon: Database,
    },
    {
      value: 'mermaid',
      label: 'Flowchart / Architecture',
      description: 'Sequence diagrams & graph flows',
      icon: GitBranch,
    },
  ]

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const lineCount = currentContent ? currentContent.split('\n').length : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-[580px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2 text-lg font-bold text-foreground'>
            <div className='flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary'>
              <Upload className='size-4' />
            </div>
            Import Document
          </DialogTitle>
          <DialogDescription className='text-xs text-muted-foreground'>
            Import .md, .dbml, or .mermaid files with automatic type detection
            and Proper Case title formatting.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className='space-y-4 pt-1'
          >
            <input
              ref={fileInputRef}
              type='file'
              accept='.md,.markdown,.dbml,.mermaid,.mmd,.txt'
              className='hidden'
              onChange={handleFileChange}
            />

            {!selectedFileName ? (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-all ${
                  isDragging
                    ? 'scale-[0.99] border-primary bg-primary/5'
                    : 'border-border/80 bg-muted/20 hover:border-primary/50 hover:bg-muted/40'
                }`}
              >
                <div className='mb-2 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary'>
                  <UploadCloud className='size-5' />
                </div>
                <p className='text-xs font-semibold text-foreground'>
                  Choose a file or drag & drop here
                </p>
                <p className='mt-1 text-[11px] text-muted-foreground'>
                  Supports .md, .dbml, .mermaid, .mmd
                </p>
              </div>
            ) : (
              <div className='flex items-center justify-between rounded-xl border border-border/80 bg-muted/30 p-3'>
                <div className='flex min-w-0 flex-1 items-center gap-3'>
                  <div className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
                    <FileCode className='size-4' />
                  </div>
                  <div className='min-w-0 flex-1'>
                    <div className='flex items-center gap-2'>
                      <p className='truncate text-xs font-semibold text-foreground'>
                        {selectedFileName}
                      </p>
                      {fileSize !== null && (
                        <span className='shrink-0 text-[10px] text-muted-foreground'>
                          ({formatFileSize(fileSize)})
                        </span>
                      )}
                    </div>
                    {detectedReason && (
                      <div className='mt-0.5 flex items-center gap-1'>
                        <Sparkles className='size-3 text-amber-500' />
                        <span className='text-[10px] text-muted-foreground'>
                          Detected via {detectedReason}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className='ml-2 flex shrink-0 items-center gap-1.5'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='h-7 px-2 text-xs text-muted-foreground hover:text-foreground'
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Change
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='size-7 text-muted-foreground hover:text-destructive'
                    onClick={handleResetFile}
                  >
                    <X className='size-3.5' />
                  </Button>
                </div>
              </div>
            )}

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
                      placeholder='e.g. Order Processing FSD'
                      className='h-9 text-xs'
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
                  <FormLabel className='flex items-center justify-between text-xs font-semibold'>
                    <span>Document Type</span>
                    {detectedReason && (
                      <span className='flex items-center gap-1 text-[10px] font-normal text-muted-foreground'>
                        <Sparkles className='size-3 text-amber-500' />{' '}
                        Auto-selected
                      </span>
                    )}
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

              {currentContent && (
                <div className='space-y-1.5 pt-1'>
                  <div className='flex items-center justify-between text-xs text-muted-foreground'>
                    <span className='text-[11px] font-semibold text-foreground'>
                      Content Preview
                    </span>
                    <span className='text-[10px]'>
                      {lineCount} {lineCount === 1 ? 'line' : 'lines'} •{' '}
                      {currentContent.length} chars
                    </span>
                  </div>
                  <ScrollArea className='h-24 w-full rounded-md border border-border/70 bg-muted/20 p-2 font-mono text-[10px] text-muted-foreground'>
                    <pre className='whitespace-pre-wrap'>
                      {currentContent.slice(0, 1000)}
                    </pre>
                  </ScrollArea>
                </div>
              )}
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
              <Button
                type='submit'
                size='sm'
                className='h-8 gap-1.5 px-4 text-xs'
                disabled={!selectedFileName || !form.watch('title').trim()}
              >
                <Check className='size-3.5' />
                <span>Import Document</span>
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
