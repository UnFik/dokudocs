import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2 } from 'lucide-react'
import { toast } from 'sonner'
import { createWorkspace } from '@/lib/domain-api'
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
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces'

const workspaceSchema = z.object({
  name: z.string().trim().min(1, 'Please enter a workspace name'),
})
type WorkspaceFormValues = z.infer<typeof workspaceSchema>

interface CreateWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: CreateWorkspaceDialogProps) {
  const queryClient = useQueryClient()
  const { setActiveWorkspace } = useWorkspaces()
  const form = useForm<WorkspaceFormValues>({
    resolver: zodResolver(workspaceSchema),
    defaultValues: { name: '' },
  })
  const createMutation = useMutation({
    mutationFn: createWorkspace,
    onSuccess: async (workspace) => {
      setActiveWorkspace(workspace.id)
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      toast.success(`Workspace "${workspace.name}" created!`)
      form.reset()
      onOpenChange(false)
    },
    onError: (error) => toast.error(error.message),
  })

  const handleSubmit = form.handleSubmit((values) =>
    createMutation.mutate({ name: values.name })
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[420px]'>
        <Form {...form}>
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <div className='flex items-center gap-2.5'>
                <div className='flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary'>
                  <Building2 className='size-5' />
                </div>
                <div>
                  <DialogTitle className='text-base font-semibold'>
                    Create Workspace
                  </DialogTitle>
                  <DialogDescription className='text-xs text-muted-foreground'>
                    Create a new space for your documents and projects.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className='space-y-4 py-4'>
              <FormField
                control={form.control}
                name='name'
                render={({ field }) => (
                  <FormItem className='space-y-1.5'>
                    <FormLabel className='text-xs font-medium'>
                      Workspace Name
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder='e.g. Acme Corp, Engineering, Personal'
                        autoFocus
                        className='text-xs'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter className='gap-2 sm:gap-0'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => onOpenChange(false)}
                className='text-xs'
              >
                Cancel
              </Button>
              <Button
                type='submit'
                size='sm'
                className='text-xs'
                disabled={createMutation.isPending}
              >
                Create Workspace
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
