import { useEffect } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { DocumentItem } from '@/types/dokudocs'
import { Pencil } from 'lucide-react'
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

const renameDocSchema = z.object({
  title: z
    .string()
    .min(1, 'Document title is required')
    .max(120, 'Document title too long'),
})

type RenameDocFormValues = z.infer<typeof renameDocSchema>

interface RenameDocDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: DocumentItem
}

export function RenameDocDialog({
  open,
  onOpenChange,
  document,
}: RenameDocDialogProps) {
  const { updateDocument } = useDokudocsStore()

  const form = useForm<RenameDocFormValues>({
    resolver: zodResolver(renameDocSchema),
    defaultValues: {
      title: document.title,
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        title: document.title,
      })
    }
  }, [open, document.title, form])

  const onSubmit = (values: RenameDocFormValues) => {
    const trimmed = values.title.trim()
    if (!trimmed) {
      toast.error('Document title cannot be empty')
      return
    }

    updateDocument(document.id, {
      title: trimmed,
    })
    toast.success(`Document renamed to "${trimmed}"`)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <div className='flex items-center gap-2 text-primary'>
                <Pencil className='size-4' />
                <DialogTitle>Rename Document</DialogTitle>
              </div>
              <DialogDescription>
                Enter a new title for &ldquo;{document.title}&rdquo;.
              </DialogDescription>
            </DialogHeader>

            <div className='grid gap-4 py-4'>
              <FormField
                control={form.control}
                name='title'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Document Title</FormLabel>
                    <FormControl>
                      <Input
                        placeholder='Enter document title...'
                        {...field}
                        autoFocus
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
              <Button type='submit'>Save Changes</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
