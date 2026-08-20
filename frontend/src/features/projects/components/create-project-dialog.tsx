import { useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { UploadCloud, X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
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
import { Textarea } from '@/components/ui/textarea'

const createProjectSchema = z.object({
  name: z.string().min(1, 'Please enter a project name'),
  description: z.string().optional(),
  logoUrl: z.string().optional(),
  categories: z.string().optional(),
})

type CreateProjectFormValues = z.infer<typeof createProjectSchema>

interface CreateProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateProjectDialog({
  open,
  onOpenChange,
}: CreateProjectDialogProps) {
  const { createProject } = useDokudocsStore()
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const form = useForm<CreateProjectFormValues>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      name: '',
      description: '',
      logoUrl: '',
      categories: '',
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        name: '',
        description: '',
        logoUrl: '',
        categories: '',
      })
    }
  }, [open, form])

  const logoUrl = form.watch('logoUrl')

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file')
      return
    }

    if (file.size > 3 * 1024 * 1024) {
      toast.error('Image file size must be less than 3MB')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      form.setValue('logoUrl', e.target?.result as string, {
        shouldValidate: true,
      })
    }
    reader.readAsDataURL(file)
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
      handleFileSelect(e.dataTransfer.files[0])
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelect(e.target.files[0])
    }
  }

  const handleRemoveLogo = () => {
    form.setValue('logoUrl', '', { shouldValidate: true })
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const onSubmit = (values: CreateProjectFormValues) => {
    const parsedCategories = values.categories
      ? values.categories
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
      : []

    const newProject = createProject(
      values.name.trim(),
      values.description?.trim(),
      values.logoUrl || undefined,
      parsedCategories
    )
    toast.success(`Project "${newProject.name}" created successfully`)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>Create New Project</DialogTitle>
              <DialogDescription>
                Organize your documents and architecture diagrams in a dedicated project.
              </DialogDescription>
            </DialogHeader>

            <div className='grid gap-4 py-4'>
              <FormField
                control={form.control}
                name='name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder='e.g. Payment Gateway Service'
                        {...field}
                        autoFocus
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormItem>
                <FormLabel>Project Logo</FormLabel>
                <input
                  ref={fileInputRef}
                  type='file'
                  accept='image/*'
                  className='hidden'
                  onChange={handleInputChange}
                />

                {logoUrl ? (
                  <div className='relative flex items-center gap-3 rounded-lg border border-border/80 p-3 bg-muted/20'>
                    <img
                      src={logoUrl}
                      alt='Project Logo Preview'
                      className='size-12 rounded-lg object-cover border border-border shadow-2xs'
                    />
                    <div className='flex-1 min-w-0'>
                      <p className='text-xs font-medium text-foreground truncate'>
                        Project Logo Selected
                      </p>
                      <p className='text-[10px] text-muted-foreground'>
                        Image ready to be assigned to this project
                      </p>
                    </div>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      onClick={handleRemoveLogo}
                      className='size-7 text-muted-foreground hover:text-destructive'
                    >
                      <X className='size-4' />
                    </Button>
                  </div>
                ) : (
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 text-center cursor-pointer transition-colors ${
                      isDragging
                        ? 'border-primary bg-primary/10'
                        : 'border-border/80 hover:border-primary/50 hover:bg-muted/30'
                    }`}
                  >
                    <div className='flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground mb-2'>
                      <UploadCloud className='size-5' />
                    </div>
                    <p className='text-xs font-medium text-foreground'>
                      Drag & drop logo image here, or{' '}
                      <span className='text-primary underline'>browse</span>
                    </p>
                    <p className='mt-0.5 text-[10px] text-muted-foreground'>
                      Supports PNG, JPG, SVG, WebP (Max 3MB)
                    </p>
                  </div>
                )}
              </FormItem>

              <FormField
                control={form.control}
                name='categories'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categories / Tags (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder='e.g. Auth, Checkout, Ledger, Core API (comma separated)'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='description'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder='Brief description of this project scope and architecture'
                        rows={2}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type='submit'>Create Project</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
