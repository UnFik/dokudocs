import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ProjectItem } from '@/types/dokudocs'
import { AlertTriangle, Check, Copy, Trash2 } from 'lucide-react'
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

interface DeleteProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: ProjectItem
}

export function DeleteProjectDialog({
  open,
  onOpenChange,
  project,
}: DeleteProjectDialogProps) {
  const { deleteProject } = useDokudocsStore()
  const [copied, setCopied] = useState(false)

  const deleteProjectSchema = z.object({
    confirmName: z
      .string()
      .min(1, 'Please enter project name')
      .refine((val) => val.trim() === project.name.trim(), {
        message: `Project name must match "${project.name}"`,
      }),
  })

  type DeleteProjectFormValues = z.infer<typeof deleteProjectSchema>

  const form = useForm<DeleteProjectFormValues>({
    resolver: zodResolver(deleteProjectSchema),
    defaultValues: {
      confirmName: '',
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({ confirmName: '' })
      setCopied(false)
    }
  }, [open, project, form])

  const confirmNameValue = form.watch('confirmName')
  const isMatch = confirmNameValue.trim() === project.name.trim()

  const handleCopyName = () => {
    navigator.clipboard.writeText(project.name)
    setCopied(true)
    toast.success('Project name copied to clipboard')
    setTimeout(() => setCopied(false), 2000)
  }

  const onSubmit = () => {
    deleteProject(project.id)
    toast.success(`Project "${project.name}" deleted successfully`)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='w-full max-w-[95vw] p-6 sm:max-w-md'>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className='w-full space-y-4'
          >
            <DialogHeader>
              <div className='flex items-center gap-2 text-destructive'>
                <div className='flex size-8 items-center justify-center rounded-lg bg-destructive/10'>
                  <Trash2 className='size-4' />
                </div>
                <DialogTitle className='text-lg font-bold text-destructive'>
                  Delete Project
                </DialogTitle>
              </div>
              <DialogDescription className='pt-1 text-xs'>
                This action is permanent and cannot be undone. Documents inside
                this project will remain intact as personal drafts.
              </DialogDescription>
            </DialogHeader>

            <div className='flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive'>
              <AlertTriangle className='mt-0.5 size-4 shrink-0' />
              <div className='flex-1 leading-relaxed'>
                To confirm deletion, please type the project name below:
              </div>
            </div>

            <div className='flex items-center justify-between rounded-lg border border-border/80 bg-muted/30 px-3 py-2'>
              <span className='truncate font-mono text-xs font-bold text-foreground select-all'>
                {project.name}
              </span>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={handleCopyName}
                className='h-7 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground'
              >
                {copied ? (
                  <>
                    <Check className='size-3 text-emerald-600 dark:text-emerald-400' />
                    <span className='text-[11px] font-medium text-emerald-600 dark:text-emerald-400'>
                      Copied
                    </span>
                  </>
                ) : (
                  <>
                    <Copy className='size-3' />
                    <span className='text-[11px]'>Copy</span>
                  </>
                )}
              </Button>
            </div>

            <FormField
              control={form.control}
              name='confirmName'
              render={({ field }) => (
                <FormItem className='w-full'>
                  <FormLabel className='text-xs font-semibold'>
                    Type &ldquo;{project.name}&rdquo; to confirm
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder={project.name}
                      className='h-9 w-full font-mono text-xs'
                      {...field}
                      autoFocus
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                variant='destructive'
                size='sm'
                disabled={!isMatch}
                className='h-8 text-xs shadow-xs'
              >
                Delete Project
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
