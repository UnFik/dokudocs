import type { DocType } from '@/types/dokudocs'
import {
  ChevronDown,
  Database,
  FileText,
  GitFork,
  Network,
  Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// Same names as the create dialog, so a type reads the same wherever it is picked.
const TYPES: { type: DocType; label: string; icon: typeof FileText }[] = [
  { type: 'markdown', label: 'Markdown', icon: FileText },
  { type: 'dbdiagram', label: 'DB Diagram', icon: Database },
  { type: 'mermaid', label: 'Mermaid diagram', icon: GitFork },
  { type: 'architecture', label: 'Architecture', icon: Network },
]

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
        {TYPES.map(({ type, label, icon: Icon }) => (
          <DropdownMenuItem key={type} onClick={() => onCreate(type)}>
            <Icon className='mr-2 size-3.5 text-muted-foreground' />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
