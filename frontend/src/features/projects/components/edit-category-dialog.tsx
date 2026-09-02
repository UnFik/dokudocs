import { useEffect } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Check, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { CATEGORY_COLOR_OPTIONS } from '@/lib/category-palette'
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

const editCategorySchema = z.object({
  newCategoryName: z
    .string()
    .min(1, 'Category name is required')
    .max(30, 'Category name too long'),
  colorId: z.string(),
})

type EditCategoryFormValues = z.infer<typeof editCategorySchema>

interface EditCategoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  categoryName: string
  currentColorId?: string
}

export function EditCategoryDialog({
  open,
  onOpenChange,
  projectId,
  categoryName,
  currentColorId = 'blue',
}: EditCategoryDialogProps) {
  const { renameProjectCategory } = useDokudocsStore()

  const form = useForm<EditCategoryFormValues>({
    resolver: zodResolver(editCategorySchema),
    defaultValues: {
      newCategoryName: categoryName,
      colorId: currentColorId,
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        newCategoryName: categoryName,
        colorId: currentColorId,
      })
    }
  }, [open, categoryName, currentColorId, form])

  const onSubmit = (values: EditCategoryFormValues) => {
    const trimmed = values.newCategoryName.trim()
    if (!trimmed) {
      toast.error('Category name cannot be empty')
      return
    }

    renameProjectCategory(projectId, categoryName, trimmed, values.colorId)
    toast.success(`Category "${trimmed}" updated`)
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
                <DialogTitle>Edit Category</DialogTitle>
              </div>
              <DialogDescription>
                Rename category &ldquo;{categoryName}&rdquo; or change its color
                palette.
              </DialogDescription>
            </DialogHeader>

            <div className='grid gap-4 py-4'>
              <FormField
                control={form.control}
                name='newCategoryName'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder='e.g. Authentication, Checkout, API'
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
                    <FormLabel>Color Palette</FormLabel>
                    <FormControl>
                      <div className='flex flex-wrap items-center gap-2 pt-1'>
                        {CATEGORY_COLOR_OPTIONS.map((opt) => {
                          const isSelected = field.value === opt.id
                          return (
                            <button
                              key={opt.id}
                              type='button'
                              onClick={() => field.onChange(opt.id)}
                              className={`size-7 rounded-full ${opt.dot} flex items-center justify-center transition-all ${
                                isSelected
                                  ? 'scale-110 shadow-xs ring-2 ring-primary ring-offset-2'
                                  : 'opacity-80 hover:scale-105 hover:opacity-100'
                              }`}
                              title={opt.name}
                            >
                              {isSelected && (
                                <Check className='size-3.5 stroke-[3] text-white' />
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
