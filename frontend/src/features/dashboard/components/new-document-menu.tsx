import type { DocType } from '@/types/dokudocs'
import { ChevronDown, Plus } from 'lucide-react'
import { DOCUMENT_TYPES } from '@/lib/document-types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** The dashboard's "New" button: opens the create dialog with the chosen type. */
export function NewDocumentMenu({
  onCreate,
}: {
  onCreate: (type: DocType) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size='sm' className='h-8 gap-1.5 px-3 text-xs font-semibold'>
          <Plus className='size-3.5' />
          <span>New</span>
          <ChevronDown className='size-3 opacity-70' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-48'>
        {DOCUMENT_TYPES.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem key={value} onClick={() => onCreate(value)}>
            <Icon className='mr-2 size-3.5 text-muted-foreground' />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
