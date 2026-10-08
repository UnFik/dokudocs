import { useRef, useState } from 'react'
import { z } from 'zod'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { DocType } from '@/types/dokudocs'
import {
  Code2,
  Database,
  FileText,
  GitBranch,
  Network,
  Plus,
  Tag,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getDefaultDocumentContent,
  useDokudocsStore,
} from '@/stores/dokudocs-store'
import { getCategoryPalette } from '@/lib/category-palette'
import {
  createDocument,
  listProjects,
  type CreateDocumentInput,
} from '@/lib/domain-api'
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
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces'
import { markdownToDocumentJSON } from '../lib/markdown-to-document-json'

const createDocSchema = z.object({
  title: z.string().min(1, 'Please enter a document title'),
  type: z.enum(['markdown', 'dbdiagram', 'mermaid', 'architecture']),
  projectId: z.string(),
  categories: z.array(z.string()),
})

type CreateDocFormValues = z.infer<typeof createDocSchema>
type CreateMutationInput = { input: CreateDocumentInput; requestID: string }

interface CreateDocDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultType?: DocType
  defaultProjectId?: string | null
  defaultCategory?: string | null
  defaultCategories?: string[]
  preselectedProjectId?: string | null
}

export function CreateDocDialog(props: CreateDocDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-[540px]'>
        {props.open && <CreateDocDialogForm key='create-doc-form' {...props} />}
      </DialogContent>
    </Dialog>
  )
}

function CreateDocDialogForm({
  onOpenChange,
  defaultType = 'markdown',
  defaultProjectId = null,
  defaultCategory = null,
  defaultCategories,
  preselectedProjectId,
}: CreateDocDialogProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { activeWorkspaceId } = useWorkspaces()
  const projectsQuery = useQuery({
    queryKey: ['projects', activeWorkspaceId],
    queryFn: ({ signal }) => listProjects(activeWorkspaceId, signal),
    enabled: Boolean(activeWorkspaceId),
  })
  const projects = projectsQuery.data ?? []
  const [customCategoryInput, setCustomCategoryInput] = useState('')
  const createRequestRef = useRef<{
    signature: string
    requestID: string
    documentID: string
  } | null>(null)

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

  const openDocument = (document: { id: string; title: string }) => {
    toast.success(`Created "${document.title}"`)
    onOpenChange(false)
    navigate({ to: '/docs/$docId', params: { docId: document.id } })
  }

  const createMutation = useMutation({
    mutationFn: ({ input, requestID }: CreateMutationInput) =>
      createDocument(activeWorkspaceId, input, requestID),
    onSuccess: async (document) => {
      useDokudocsStore.getState().upsertDocument(document)
      await queryClient.invalidateQueries({
        queryKey: ['documents', activeWorkspaceId],
      })
      openDocument(document)
    },
    onError: (error) => toast.error(error.message),
  })

  const selectedProjectId = useWatch({
    control: form.control,
    name: 'projectId',
  })
  const activeProject = projects.find((p) => p.id === selectedProjectId)
  const availableProjectCategories = activeProject?.categories ?? []
  const selectedCategories = useWatch({
    control: form.control,
    name: 'categories',
  })

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

  const onSubmit = async (values: CreateDocFormValues) => {
    const projectId =
      values.projectId === 'unassigned' ? null : values.projectId
    const common = {
      title: values.title.trim(),
      projectId,
      categories: values.categories,
      isDraft: !projectId,
    }
    const content = getDefaultDocumentContent(values.type)
    const signature = JSON.stringify({
      workspaceID: activeWorkspaceId,
      common,
      type: values.type,
      content,
    })
    const previous = createRequestRef.current
    const requestID =
      previous?.signature === signature
        ? previous.requestID
        : crypto.randomUUID()
    const documentID =
      previous?.signature === signature
        ? previous.documentID
        : crypto.randomUUID()
    createRequestRef.current = { signature, requestID, documentID }

    if (values.type === 'markdown') {
      try {
        const contentJSON = await markdownToDocumentJSON(content)
        createMutation.mutate({
          requestID,
          input: {
            ...common,
            type: 'markdown',
            content: content,
            contentJSON,
          },
        })
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Could not parse Markdown'
        )
      }
      return
    }

    if (values.type === 'architecture') {
      // The API starts an empty canvas; its text is derived from the canvas.
      createMutation.mutate({
        requestID,
        input: { ...common, type: 'architecture' },
      })
      return
    }

    createMutation.mutate({
      requestID,
      input: { ...common, type: values.type, content },
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
      label: 'Mermaid diagram',
      description: 'Flowcharts & sequence diagrams as text',
      icon: GitBranch,
    },
    {
      value: 'architecture',
      label: 'Architecture',
      description: 'Hosts, systems and how they connect, edited together',
      icon: Network,
    },
  ]

  return (
    <>
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
            <Button
              type='submit'
              size='sm'
              className='h-8 px-4 text-xs'
              disabled={!activeWorkspaceId || createMutation.isPending}
            >
              Create Document
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  )
}
