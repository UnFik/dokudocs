import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ProjectItem } from '@/types/dokudocs'
import { Pencil, UploadCloud, X } from 'lucide-react'
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

const editProjectSchema = z.object({
  name: z.string().min(1, 'Please enter a project name'),
  description: z.string().optional(),
  logoUrl: z.string().optional(),
})

type EditProjectFormValues = z.infer<typeof editProjectSchema>

interface EditProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: ProjectItem
}

export function EditProjectDialog({
  open,
  onOpenChange,
  project,
}: EditProjectDialogProps) {
  const { updateProject } = useDokudocsStore()
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const form = useForm<EditProjectFormValues>({
    resolver: zodResolver(editProjectSchema),
    defaultValues: {
      name: project.name,
      description: project.description || '',
      logoUrl: project.logoUrl || '',
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        name: project.name,
        description: project.description || '',
        logoUrl: project.logoUrl || '',
      })
    }
  }, [open, project, form])

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

  const onSubmit = (values: EditProjectFormValues) => {
    updateProject(project.id, {
      name: values.name.trim(),
      description: values.description?.trim() || undefined,
      logoUrl: values.logoUrl || undefined,
    })

    toast.success(`Project "${values.name.trim()}" updated successfully`)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='w-full max-w-[95vw] p-6 sm:max-w-lg'>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className='w-full space-y-4'
          >
            <DialogHeader>
              <div className='flex items-center gap-2 text-primary'>
                <Pencil className='size-4' />
                <DialogTitle>Edit Project</DialogTitle>
              </div>
              <DialogDescription>
                Update project title, description, and branding logo.
              </DialogDescription>
            </DialogHeader>

            <div className='w-full space-y-4 py-2'>
              <FormField
                control={form.control}
                name='name'
                render={({ field }) => (
                  <FormItem className='w-full'>
                    <FormLabel className='text-xs font-semibold'>
                      Project Name
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder='e.g. Payment Gateway Service'
                        className='h-9 w-full text-xs'
                        {...field}
                        autoFocus
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormItem className='w-full'>
                <FormLabel className='text-xs font-semibold'>
                  Project Logo
                </FormLabel>
                <input
                  ref={fileInputRef}
                  type='file'
                  accept='image/*'
                  className='hidden'
                  onChange={handleInputChange}
                />

                {logoUrl ? (
                  <div className='relative flex w-full items-center gap-3 rounded-lg border border-border/80 bg-muted/20 p-3'>
                    <img
                      src={logoUrl}
                      alt='Project Logo Preview'
                      className='size-12 rounded-lg border border-border object-cover shadow-2xs'
                    />
                    <div className='min-w-0 flex-1'>
                      <p className='truncate text-xs font-medium text-foreground'>
                        Current Project Logo
                      </p>
                      <p className='text-[10px] text-muted-foreground'>
                        Click remove to clear or upload a new logo
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
                    className={`flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
                      isDragging
                        ? 'border-primary bg-primary/10'
                        : 'border-border/80 hover:border-primary/50 hover:bg-muted/30'
                    }`}
                  >
                    <div className='mb-2 flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground'>
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
                name='description'
                render={({ field }) => (
                  <FormItem className='w-full'>
                    <FormLabel className='text-xs font-semibold'>
                      Description (Optional)
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder='Brief description of this project scope and architecture'
                        rows={3}
                        className='w-full text-xs'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
              <Button type='submit' size='sm' className='h-8 text-xs shadow-xs'>
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
