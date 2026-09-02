import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { DocumentItem, ProjectItem } from '@/types/dokudocs'
import {
  ChevronRight,
  Copy,
  Database,
  ExternalLink,
  FileText,
  Folder,
  GitFork,
  Star,
  StarOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar'

type StarredEntry =
  | { kind: 'project'; data: ProjectItem; timestamp: number }
  | { kind: 'document'; data: DocumentItem; timestamp: number }

export function StarredNavGroup() {
  const navigate = useNavigate()
  const { state, isMobile, setOpenMobile } = useSidebar()
  const href = useLocation({ select: (location) => location.href })
  const activeOrgId = useDokudocsStore((s) => s.activeOrgId)
  const projects = useDokudocsStore((s) => s.projects)
  const documents = useDokudocsStore((s) => s.documents)
  const toggleStarProject = useDokudocsStore((s) => s.toggleStarProject)
  const toggleStarDocument = useDokudocsStore((s) => s.toggleStarDocument)

  const starredProjects = (projects || []).filter(
    (p) => p.isStarred && p.orgId === activeOrgId
  )
  const starredDocs = (documents || []).filter(
    (d) => d.isStarred && !d.deletedAt && d.orgId === activeOrgId
  )

  const totalCount = starredProjects.length + starredDocs.length

  const starredEntries: StarredEntry[] = [
    ...starredProjects.map((p) => ({
      kind: 'project' as const,
      data: p,
      timestamp: new Date(
        p.starredAt || p.updatedAt || p.createdAt || 0
      ).getTime(),
    })),
    ...starredDocs.map((d) => ({
      kind: 'document' as const,
      data: d,
      timestamp: new Date(
        d.starredAt || d.updatedAt || d.createdAt || 0
      ).getTime(),
    })),
  ].sort((a, b) => b.timestamp - a.timestamp)

  const getDocIcon = (type: string) => {
    switch (type) {
      case 'dbdiagram':
        return Database
      case 'mermaid':
        return GitFork
      case 'markdown':
      default:
        return FileText
    }
  }

  if (state === 'collapsed' && !isMobile) {
    return (
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton tooltip={`Starred (${totalCount})`}>
                  <Star className='size-4 fill-amber-400 text-amber-500' />
                  <span>Starred</span>
                  {totalCount > 0 && (
                    <Badge className='rounded-full px-1.5 py-0 text-[10px]'>
                      {totalCount}
                    </Badge>
                  )}
                  <ChevronRight className='ms-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90' />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side='right'
                align='start'
                sideOffset={4}
                className='w-56'
              >
                <DropdownMenuLabel className='flex items-center justify-between text-xs font-semibold'>
                  <span className='flex items-center gap-1.5'>
                    <Star className='size-3.5 fill-amber-400 text-amber-500' />
                    Starred
                  </span>
                  <span className='text-[10px] font-normal text-muted-foreground'>
                    {totalCount} items
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                {totalCount === 0 ? (
                  <div className='px-2 py-3 text-center text-xs text-muted-foreground italic'>
                    No starred items yet
                  </div>
                ) : (
                  <div className='max-h-64 space-y-0.5 overflow-y-auto'>
                    {starredEntries.map((entry) => {
                      if (entry.kind === 'project') {
                        const p = entry.data
                        return (
                          <ContextMenu key={`star-proj-collapsed-${p.id}`}>
                            <ContextMenuTrigger asChild>
                              <DropdownMenuItem asChild>
                                <Link
                                  to='/projects/$projectId'
                                  params={{ projectId: p.id }}
                                  className={`flex cursor-pointer items-center gap-2 text-xs ${
                                    href.includes(p.id)
                                      ? 'bg-secondary font-medium'
                                      : ''
                                  }`}
                                >
                                  {p.logoUrl ? (
                                    <img
                                      src={p.logoUrl}
                                      alt={p.name}
                                      className='size-3.5 shrink-0 rounded object-cover'
                                    />
                                  ) : (
                                    <Folder className='size-3.5 shrink-0 text-primary' />
                                  )}
                                  <span className='truncate'>{p.name}</span>
                                </Link>
                              </DropdownMenuItem>
                            </ContextMenuTrigger>
                            <ContextMenuContent className='w-48'>
                              <ContextMenuItem
                                onClick={() => {
                                  navigate({
                                    to: '/projects/$projectId',
                                    params: { projectId: p.id },
                                  })
                                }}
                              >
                                <Folder className='mr-2 size-3.5 text-primary' />
                                Open
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() => {
                                  window.open(`/projects/${p.id}`, '_blank')
                                }}
                              >
                                <ExternalLink className='mr-2 size-3.5' />
                                Open in new tab
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                onClick={() => {
                                  toggleStarProject(p.id)
                                  toast.success(`Unstarred "${p.name}"`)
                                }}
                              >
                                <StarOff className='mr-2 size-3.5 text-amber-500' />
                                Unstar
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                onClick={() => {
                                  navigator.clipboard.writeText(
                                    `${window.location.origin}/projects/${p.id}`
                                  )
                                  toast.success(
                                    'Project link copied to clipboard'
                                  )
                                }}
                              >
                                <Copy className='mr-2 size-3.5' />
                                Copy link
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        )
                      }

                      const doc = entry.data
                      const Icon = getDocIcon(doc.type)
                      return (
                        <ContextMenu key={`star-doc-collapsed-${doc.id}`}>
                          <ContextMenuTrigger asChild>
                            <DropdownMenuItem asChild>
                              <Link
                                to='/docs/$docId'
                                params={{ docId: doc.id }}
                                className={`flex cursor-pointer items-center gap-2 text-xs ${
                                  href.includes(doc.id)
                                    ? 'bg-secondary font-medium'
                                    : ''
                                }`}
                              >
                                <Icon className='size-3.5 shrink-0 text-blue-500' />
                                <span className='truncate'>{doc.title}</span>
                              </Link>
                            </DropdownMenuItem>
                          </ContextMenuTrigger>
                          <ContextMenuContent className='w-48'>
                            <ContextMenuItem
                              onClick={() => {
                                navigate({
                                  to: '/docs/$docId',
                                  params: { docId: doc.id },
                                })
                              }}
                            >
                              <Icon className='mr-2 size-3.5 text-blue-500' />
                              Open
                            </ContextMenuItem>
                            <ContextMenuItem
                              onClick={() => {
                                window.open(`/docs/${doc.id}`, '_blank')
                              }}
                            >
                              <ExternalLink className='mr-2 size-3.5' />
                              Open in new tab
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              onClick={() => {
                                toggleStarDocument(doc.id)
                                toast.success(`Unstarred "${doc.title}"`)
                              }}
                            >
                              <StarOff className='mr-2 size-3.5 text-amber-500' />
                              Unstar
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              onClick={() => {
                                navigator.clipboard.writeText(
                                  `${window.location.origin}/docs/${doc.id}`
                                )
                                toast.success(
                                  'Document link copied to clipboard'
                                )
                              }}
                            >
                              <Copy className='mr-2 size-3.5' />
                              Copy link
                            </ContextMenuItem>
                            {doc.projectId && (
                              <ContextMenuItem
                                onClick={() => {
                                  navigate({
                                    to: '/projects/$projectId',
                                    params: { projectId: doc.projectId! },
                                  })
                                }}
                              >
                                <Folder className='mr-2 size-3.5 text-primary' />
                                Show in project
                              </ContextMenuItem>
                            )}
                          </ContextMenuContent>
                        </ContextMenu>
                      )
                    })}
                  </div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    )
  }

  return (
    <SidebarGroup>
      <SidebarMenu>
        <Collapsible defaultOpen className='group/collapsible'>
          <SidebarMenuItem>
            <CollapsibleTrigger asChild>
              <SidebarMenuButton tooltip='Starred'>
                <Star className='size-4 fill-amber-400 text-amber-500' />
                <span className='font-medium'>Starred</span>
                <Badge
                  variant='secondary'
                  className='ml-auto h-4 px-1.5 py-0 text-[10px] font-semibold'
                >
                  {totalCount}
                </Badge>
                <ChevronRight className='transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 rtl:rotate-180' />
              </SidebarMenuButton>
            </CollapsibleTrigger>
            <CollapsibleContent className='CollapsibleContent'>
              <SidebarMenuSub>
                {totalCount === 0 ? (
                  <div className='px-3 py-2 text-[11px] text-muted-foreground/70 italic'>
                    No starred items yet
                  </div>
                ) : (
                  <>
                    {starredEntries.map((entry) => {
                      if (entry.kind === 'project') {
                        const p = entry.data
                        const isActive = href.includes(p.id)
                        return (
                          <SidebarMenuSubItem key={`star-proj-${p.id}`}>
                            <ContextMenu>
                              <ContextMenuTrigger asChild>
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={isActive}
                                >
                                  <Link
                                    to='/projects/$projectId'
                                    params={{ projectId: p.id }}
                                    onClick={() => setOpenMobile(false)}
                                  >
                                    {p.logoUrl ? (
                                      <img
                                        src={p.logoUrl}
                                        alt={p.name}
                                        className='size-3.5 shrink-0 rounded object-cover'
                                      />
                                    ) : (
                                      <Folder className='size-3.5 shrink-0 text-primary' />
                                    )}
                                    <span className='truncate'>{p.name}</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </ContextMenuTrigger>
                              <ContextMenuContent className='w-48'>
                                <ContextMenuItem
                                  onClick={() => {
                                    navigate({
                                      to: '/projects/$projectId',
                                      params: { projectId: p.id },
                                    })
                                    setOpenMobile(false)
                                  }}
                                >
                                  <Folder className='mr-2 size-3.5 text-primary' />
                                  Open
                                </ContextMenuItem>
                                <ContextMenuItem
                                  onClick={() => {
                                    window.open(`/projects/${p.id}`, '_blank')
                                  }}
                                >
                                  <ExternalLink className='mr-2 size-3.5' />
                                  Open in new tab
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                                <ContextMenuItem
                                  onClick={() => {
                                    toggleStarProject(p.id)
                                    toast.success(`Unstarred "${p.name}"`)
                                  }}
                                >
                                  <StarOff className='mr-2 size-3.5 text-amber-500' />
                                  Unstar
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                                <ContextMenuItem
                                  onClick={() => {
                                    navigator.clipboard.writeText(
                                      `${window.location.origin}/projects/${p.id}`
                                    )
                                    toast.success(
                                      'Project link copied to clipboard'
                                    )
                                  }}
                                >
                                  <Copy className='mr-2 size-3.5' />
                                  Copy link
                                </ContextMenuItem>
                              </ContextMenuContent>
                            </ContextMenu>
                          </SidebarMenuSubItem>
                        )
                      }

                      const doc = entry.data
                      const Icon = getDocIcon(doc.type)
                      const isActive = href.includes(doc.id)
                      return (
                        <SidebarMenuSubItem key={`star-doc-${doc.id}`}>
                          <ContextMenu>
                            <ContextMenuTrigger asChild>
                              <SidebarMenuSubButton asChild isActive={isActive}>
                                <Link
                                  to='/docs/$docId'
                                  params={{ docId: doc.id }}
                                  onClick={() => setOpenMobile(false)}
                                >
                                  <Icon className='size-3.5 shrink-0 text-blue-500' />
                                  <span className='truncate'>{doc.title}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </ContextMenuTrigger>
                            <ContextMenuContent className='w-48'>
                              <ContextMenuItem
                                onClick={() => {
                                  navigate({
                                    to: '/docs/$docId',
                                    params: { docId: doc.id },
                                  })
                                  setOpenMobile(false)
                                }}
                              >
                                <Icon className='mr-2 size-3.5 text-blue-500' />
                                Open
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() => {
                                  window.open(`/docs/${doc.id}`, '_blank')
                                }}
                              >
                                <ExternalLink className='mr-2 size-3.5' />
                                Open in new tab
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                onClick={() => {
                                  toggleStarDocument(doc.id)
                                  toast.success(`Unstarred "${doc.title}"`)
                                }}
                              >
                                <StarOff className='mr-2 size-3.5 text-amber-500' />
                                Unstar
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                onClick={() => {
                                  navigator.clipboard.writeText(
                                    `${window.location.origin}/docs/${doc.id}`
                                  )
                                  toast.success(
                                    'Document link copied to clipboard'
                                  )
                                }}
                              >
                                <Copy className='mr-2 size-3.5' />
                                Copy link
                              </ContextMenuItem>
                              {doc.projectId && (
                                <ContextMenuItem
                                  onClick={() => {
                                    navigate({
                                      to: '/projects/$projectId',
                                      params: { projectId: doc.projectId! },
                                    })
                                    setOpenMobile(false)
                                  }}
                                >
                                  <Folder className='mr-2 size-3.5 text-primary' />
                                  Show in project
                                </ContextMenuItem>
                              )}
                            </ContextMenuContent>
                          </ContextMenu>
                        </SidebarMenuSubItem>
                      )
                    })}
                  </>
                )}
              </SidebarMenuSub>
            </CollapsibleContent>
          </SidebarMenuItem>
        </Collapsible>
      </SidebarMenu>
    </SidebarGroup>
  )
}
