import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { DocType } from '@/types/dokudocs'
import {
  Database,
  ExternalLink,
  FileText,
  Folder,
  GitFork,
  Search,
  Network,
} from 'lucide-react'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { formatRelativeTime } from '@/lib/time-utils'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'

interface ProjectDocsHoverCardProps {
  projectId: string
  currentDocId: string
  children: React.ReactNode
}

function getDocTypeIcon(type: DocType) {
  switch (type) {
    case 'mermaid':
      return <GitFork className='size-3.5 shrink-0 text-muted-foreground' />
    case 'dbdiagram':
      return <Database className='size-3.5 shrink-0 text-muted-foreground' />
    case 'architecture':
      return <Network className='size-3.5 shrink-0 text-muted-foreground' />
    case 'markdown':
    default:
      return <FileText className='size-3.5 shrink-0 text-muted-foreground' />
  }
}

export function ProjectDocsHoverCard({
  projectId,
  currentDocId,
  children,
}: ProjectDocsHoverCardProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const { projects, documents } = useDokudocsStore()

  const project = projects.find((p) => p.id === projectId)
  const projectDocs = useMemo(
    () => documents.filter((d) => d.projectId === projectId),
    [documents, projectId]
  )

  const filteredDocs = useMemo(() => {
    if (!searchQuery.trim()) return projectDocs
    const q = searchQuery.toLowerCase().trim()
    return projectDocs.filter((d) => d.title.toLowerCase().includes(q))
  }, [projectDocs, searchQuery])

  if (!project) {
    return <>{children}</>
  }

  return (
    <HoverCard
      open={open}
      onOpenChange={setOpen}
      openDelay={200}
      closeDelay={300}
    >
      <HoverCardTrigger
        asChild
        onClick={(e) => {
          e.preventDefault()
          setOpen((prev) => !prev)
        }}
      >
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        align='start'
        side='bottom'
        sideOffset={8}
        onPointerDownOutside={() => setOpen(false)}
        onEscapeKeyDown={() => setOpen(false)}
        className='flex max-h-[420px] w-80 flex-col overflow-hidden border-border/80 p-0 shadow-sm'
      >
        {/* Header */}
        <div className='flex shrink-0 items-center justify-between border-b border-border/60 p-3 pb-2.5'>
          <div className='flex min-w-0 items-center gap-2'>
            <div className='flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground'>
              <Folder className='size-3.5' />
            </div>
            <div className='min-w-0'>
              <p className='truncate text-xs font-semibold text-foreground'>
                {project.name}
              </p>
              <p className='text-[10px] text-muted-foreground'>
                {projectDocs.length} {projectDocs.length === 1 ? 'doc' : 'docs'}
              </p>
            </div>
          </div>
          <Button
            variant='ghost'
            size='sm'
            asChild
            className='h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground'
          >
            <Link
              to='/projects/$projectId'
              params={{ projectId }}
              onClick={() => setOpen(false)}
            >
              <span>View</span>
              <ExternalLink className='size-3' />
            </Link>
          </Button>
        </div>

        {/* Search */}
        {projectDocs.length > 2 && (
          <div className='shrink-0 border-b border-border/40 p-2'>
            <div className='relative'>
              <Search className='absolute top-2 left-2.5 size-3.5 text-muted-foreground/70' />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder='Search in project...'
                className='h-7.5 pr-2 pl-8 text-xs'
              />
            </div>
          </div>
        )}

        {/* Document List */}
        <ScrollArea
          type='always'
          className='max-h-64 overflow-hidden p-1.5 pr-2 [&_[data-slot=scroll-area-viewport]]:max-h-64'
        >
          {filteredDocs.length === 0 ? (
            <div className='py-6 text-center text-xs text-muted-foreground'>
              {searchQuery
                ? 'No documents matching search'
                : 'No documents in this project'}
            </div>
          ) : (
            <div className='space-y-0.5'>
              {filteredDocs.map((item) => {
                const isCurrent = item.id === currentDocId
                return (
                  <Link
                    key={item.id}
                    to='/docs/$docId'
                    params={{ docId: item.id }}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-muted/80',
                      isCurrent && 'bg-muted/60 font-medium text-foreground'
                    )}
                  >
                    <div className='flex min-w-0 items-center gap-2'>
                      {getDocTypeIcon(item.type)}
                      <span className='truncate text-xs text-foreground'>
                        {item.title || 'Untitled'}
                      </span>
                    </div>

                    <div className='flex shrink-0 items-center gap-1.5'>
                      {isCurrent ? (
                        <Badge
                          variant='secondary'
                          className='h-4 px-1 text-[9px] font-semibold text-primary'
                        >
                          Current
                        </Badge>
                      ) : (
                        <span className='text-[10px] text-muted-foreground/70 group-hover:text-muted-foreground'>
                          {formatRelativeTime(item.updatedAt)}
                        </span>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </HoverCardContent>
    </HoverCard>
  )
}
