import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { DocumentItem } from '@/types/dokudocs'
import {
  Check,
  Copy,
  ExternalLink,
  FileEdit,
  Folder,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
  Tag,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { getCategoryPalette } from '@/lib/category-palette'
import { getDocCategories } from '@/lib/doc-category-utils'
import { formatRelativeTime } from '@/lib/time-utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DocThumbnailPreview } from './doc-thumbnail-preview'
import { DocTypeBadge } from './doc-type-badge'
import { MoveDocDialog } from './move-doc-dialog'
import { RenameDocDialog } from './rename-doc-dialog'
import { SetDocCategoryDialog } from './set-doc-category-dialog'

interface DocCardProps {
  document: DocumentItem
}

export function DocCard({ document }: DocCardProps) {
  const navigate = useNavigate()
  const {
    projects,
    activeOrgId,
    updateDocument,
    recordDocumentView,
    moveToTrash,
    toggleStarDocument,
    duplicateDocument,
    moveDocumentToProject,
  } = useDokudocsStore()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [moveDialogOpen, setMoveDialogOpen] = useState(false)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [confirmMoveOpen, setConfirmMoveOpen] = useState(false)
  const [pendingTargetProjectId, setPendingTargetProjectId] = useState<
    string | null | undefined
  >(undefined)

  const project = projects.find((p) => p.id === document.projectId)
  const projectCategories = project?.categories ?? []
  const docCategories = getDocCategories(document)
  const orgProjects = (projects || []).filter((p) => p.orgId === activeOrgId)

  const handleCopyLink = () => {
    navigator.clipboard.writeText(
      `${window.location.origin}/docs/${document.id}`
    )
    toast.success('Document link copied to clipboard')
  }

  const handleDuplicate = () => {
    duplicateDocument(document.id)
    toast.success('Document duplicated successfully')
  }

  const handleDelete = () => {
    moveToTrash(document.id)
    toast.success('Moved document to Trash', {
      action: {
        label: 'Undo',
        onClick: () =>
          useDokudocsStore.getState().restoreFromTrash(document.id),
      },
    })
  }

  const handleToggleCategory = (cat: string) => {
    const current = getDocCategories(document)
    const next = current.includes(cat)
      ? current.filter((c) => c !== cat)
      : [...current, cat]
    updateDocument(document.id, {
      categories: next,
      category: next[0] ?? null,
    })
  }

  const handleClearCategories = () => {
    updateDocument(document.id, {
      categories: [],
      category: null,
    })
    toast.success('Categories cleared')
  }

  const handleRequestMove = (targetId: string | null) => {
    if (document.projectId && targetId !== document.projectId) {
      setPendingTargetProjectId(targetId)
      setConfirmMoveOpen(true)
    } else if (!document.projectId) {
      moveDocumentToProject(document.id, targetId)
      if (targetId) {
        const targetProj = projects.find((p) => p.id === targetId)
        toast.success(
          `Moved "${document.title}" to "${targetProj?.name || 'Project'}"`
        )
      } else {
        toast.success(`Moved "${document.title}" to Drafts`)
      }
    }
  }

  const handleConfirmMove = () => {
    if (pendingTargetProjectId !== undefined) {
      moveDocumentToProject(document.id, pendingTargetProjectId)
      if (pendingTargetProjectId) {
        const targetProj = projects.find((p) => p.id === pendingTargetProjectId)
        toast.success(
          `Moved "${document.title}" to "${targetProj?.name || 'Project'}"`
        )
      } else {
        toast.success(`Moved "${document.title}" to Drafts`)
      }
      setConfirmMoveOpen(false)
      setPendingTargetProjectId(undefined)
    }
  }

  const handleCardClick = () => {
    recordDocumentView(document.id)
    navigate({
      to: '/docs/$docId',
      params: { docId: document.id },
    })
  }

  const targetProject = projects.find((p) => p.id === pendingTargetProjectId)

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            onClick={handleCardClick}
            className='group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-xl border border-border/80 bg-card transition-all duration-200 select-none hover:-translate-y-0.5 hover:border-sidebar-ring/60 hover:shadow-md'
          >
            <div className='relative h-32 w-full border-b border-border/40'>
              <DocThumbnailPreview
                docId={document.id}
                type={document.type}
                content={document.content}
                thumbnail={document.thumbnail || document.thumbnailPreview}
                thumbnailDark={
                  document.thumbnailDark || document.thumbnailPreviewDark
                }
                className='h-full w-full'
              />

              <button
                type='button'
                onClick={(e) => {
                  e.stopPropagation()
                  toggleStarDocument(document.id)
                }}
                className='absolute top-2.5 right-2.5 flex size-7 items-center justify-center rounded-full bg-background/80 text-muted-foreground shadow-2xs backdrop-blur-xs transition-transform hover:scale-110 hover:text-amber-500'
              >
                <Star
                  className={`size-3.5 ${
                    document.isStarred
                      ? 'fill-amber-400 text-amber-500'
                      : 'text-muted-foreground/80'
                  }`}
                />
              </button>
            </div>

            <div className='flex flex-1 flex-col justify-between p-3.5'>
              <div>
                <div className='mb-1.5 flex items-center justify-between gap-2'>
                  <div className='flex flex-wrap items-center gap-1.5'>
                    <DocTypeBadge type={document.type} />
                    {docCategories.length > 0 &&
                      (() => {
                        const firstCat = docCategories[0]
                        const colorId = project?.categoryColors?.[firstCat]
                        const categoryPalette = getCategoryPalette(
                          firstCat,
                          colorId,
                          0
                        )
                        const remainingCount = docCategories.length - 1

                        return (
                          <>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[9px] font-medium ${categoryPalette.bg} ${categoryPalette.text} ${categoryPalette.border}`}
                            >
                              {firstCat}
                            </span>
                            {remainingCount > 0 && (
                              <span
                                title={docCategories.slice(1).join(', ')}
                                className='rounded-full border border-border/80 bg-muted/60 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground'
                              >
                                +{remainingCount}
                              </span>
                            )}
                          </>
                        )
                      })()}
                  </div>

                  <div onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu
                      open={dropdownOpen}
                      onOpenChange={setDropdownOpen}
                    >
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='size-6 text-muted-foreground opacity-70 hover:opacity-100'
                        >
                          <MoreHorizontal className='size-3.5' />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end' className='w-48'>
                        <DropdownMenuItem asChild>
                          <Link
                            to='/docs/$docId'
                            params={{ docId: document.id }}
                          >
                            <FileEdit className='mr-2 size-3.5' />
                            Open Editor
                          </Link>
                        </DropdownMenuItem>

                        <DropdownMenuItem
                          onClick={() => {
                            recordDocumentView(document.id)
                            window.open(`/docs/${document.id}`, '_blank')
                          }}
                        >
                          <ExternalLink className='mr-2 size-3.5' />
                          <span>Open in New Tab</span>
                        </DropdownMenuItem>

                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault()
                            setRenameDialogOpen(true)
                          }}
                        >
                          <Pencil className='mr-2 size-3.5' />
                          Rename
                        </DropdownMenuItem>

                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <FolderInput className='mr-2 size-3.5' />
                            Move to Project
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className='w-52'>
                            <DropdownMenuItem
                              onClick={() => handleRequestMove(null)}
                              disabled={!document.projectId}
                            >
                              <span className='flex-1'>
                                Drafts (No Project)
                              </span>
                              {!document.projectId && (
                                <Check className='size-3.5' />
                              )}
                            </DropdownMenuItem>
                            {orgProjects.length > 0 && (
                              <DropdownMenuSeparator />
                            )}
                            {orgProjects.map((p) => {
                              const isCurrent = document.projectId === p.id
                              return (
                                <DropdownMenuItem
                                  key={p.id}
                                  onClick={() => handleRequestMove(p.id)}
                                  className='flex items-center justify-between'
                                >
                                  <div className='flex items-center gap-1.5 truncate'>
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
                                  </div>
                                  {isCurrent && <Check className='size-3.5' />}
                                </DropdownMenuItem>
                              )
                            })}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={(e) => {
                                e.preventDefault()
                                setMoveDialogOpen(true)
                              }}
                            >
                              <FolderInput className='mr-2 size-3.5' />
                              Choose Project...
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>

                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <Tag className='mr-2 size-3.5' />
                            Categories
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className='w-48'>
                            <DropdownMenuItem
                              onClick={handleClearCategories}
                              disabled={docCategories.length === 0}
                            >
                              <span className='flex-1 text-muted-foreground'>
                                Clear All
                              </span>
                              {docCategories.length === 0 && (
                                <Check className='size-3.5' />
                              )}
                            </DropdownMenuItem>
                            {projectCategories.length > 0 && (
                              <DropdownMenuSeparator />
                            )}
                            {projectCategories.map((c, idx) => {
                              const isSelected = docCategories.includes(c)
                              const colorId = project?.categoryColors?.[c]
                              const palette = getCategoryPalette(
                                c,
                                colorId,
                                idx
                              )
                              return (
                                <DropdownMenuItem
                                  key={c}
                                  onClick={() => handleToggleCategory(c)}
                                  className='flex items-center justify-between'
                                >
                                  <div className='flex items-center gap-1.5 truncate'>
                                    <div
                                      className={`size-1.5 rounded-full ${palette.dot}`}
                                    />
                                    <span className='truncate'>{c}</span>
                                  </div>
                                  {isSelected && <Check className='size-3.5' />}
                                </DropdownMenuItem>
                              )
                            })}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={(e) => {
                                e.preventDefault()
                                setCategoryDialogOpen(true)
                              }}
                            >
                              <Plus className='mr-2 size-3.5' />
                              Manage Categories...
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>

                        <DropdownMenuSeparator />

                        <DropdownMenuItem onClick={handleCopyLink}>
                          <Copy className='mr-2 size-3.5' />
                          Copy Link
                        </DropdownMenuItem>

                        <DropdownMenuItem onClick={handleDuplicate}>
                          <Plus className='mr-2 size-3.5' />
                          Duplicate
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />

                        <DropdownMenuItem
                          onClick={handleDelete}
                          className='text-destructive focus:text-destructive'
                        >
                          <Trash2 className='mr-2 size-3.5' />
                          Move to Trash
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <h3 className='line-clamp-1 text-sm font-medium tracking-tight text-foreground transition-colors group-hover:text-primary'>
                  {document.title}
                </h3>

                <p className='mt-1 line-clamp-1 text-[11px] font-normal text-muted-foreground/80'>
                  {document.projectName || 'Personal Draft'}
                </p>
              </div>

              <div className='mt-3 flex items-center justify-between border-t border-border/40 pt-2.5 text-[10px] text-muted-foreground'>
                <div className='flex items-center gap-1.5'>
                  <Avatar className='size-4'>
                    <AvatarImage
                      src={document.author.avatar}
                      alt={document.author.name}
                    />
                    <AvatarFallback className='text-[8px]'>
                      {document.author.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className='max-w-[80px] truncate font-medium'>
                    {document.author.name}
                  </span>
                </div>

                <span>
                  {formatRelativeTime(
                    document.lastViewedAt || document.updatedAt
                  )}
                </span>
              </div>
            </div>
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent className='w-52'>
          <ContextMenuItem asChild>
            <Link to='/docs/$docId' params={{ docId: document.id }}>
              <FileEdit className='mr-2 size-3.5' />
              Open Editor
            </Link>
          </ContextMenuItem>

          <ContextMenuItem
            onClick={() => {
              recordDocumentView(document.id)
              window.open(`/docs/${document.id}`, '_blank')
            }}
          >
            <ExternalLink className='mr-2 size-3.5' />
            <span>Open in New Tab</span>
          </ContextMenuItem>

          <ContextMenuItem onClick={() => toggleStarDocument(document.id)}>
            <Star
              className={`mr-2 size-3.5 ${
                document.isStarred ? 'fill-amber-400 text-amber-500' : ''
              }`}
            />
            <span>
              {document.isStarred ? 'Unstar Document' : 'Star Document'}
            </span>
          </ContextMenuItem>

          <ContextMenuItem
            onSelect={(e) => {
              e.preventDefault()
              setRenameDialogOpen(true)
            }}
          >
            <Pencil className='mr-2 size-3.5' />
            Rename
          </ContextMenuItem>

          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <FolderInput className='mr-2 size-3.5' />
              Move to Project
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className='w-52'>
              <ContextMenuItem
                onClick={() => handleRequestMove(null)}
                disabled={!document.projectId}
              >
                <span className='flex-1'>Drafts (No Project)</span>
                {!document.projectId && <Check className='size-3.5' />}
              </ContextMenuItem>
              {orgProjects.length > 0 && <ContextMenuSeparator />}
              {orgProjects.map((p) => {
                const isCurrent = document.projectId === p.id
                return (
                  <ContextMenuItem
                    key={p.id}
                    onClick={() => handleRequestMove(p.id)}
                    className='flex items-center justify-between'
                  >
                    <div className='flex items-center gap-1.5 truncate'>
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
                    </div>
                    {isCurrent && <Check className='size-3.5' />}
                  </ContextMenuItem>
                )
              })}
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={(e) => {
                  e.preventDefault()
                  setMoveDialogOpen(true)
                }}
              >
                <FolderInput className='mr-2 size-3.5' />
                Choose Project...
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>

          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Tag className='mr-2 size-3.5' />
              Categories
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className='w-48'>
              <ContextMenuItem
                onClick={handleClearCategories}
                disabled={docCategories.length === 0}
              >
                <span className='flex-1 text-muted-foreground'>Clear All</span>
                {docCategories.length === 0 && <Check className='size-3.5' />}
              </ContextMenuItem>
              {projectCategories.length > 0 && <ContextMenuSeparator />}
              {projectCategories.map((c, idx) => {
                const isSelected = docCategories.includes(c)
                const colorId = project?.categoryColors?.[c]
                const palette = getCategoryPalette(c, colorId, idx)
                return (
                  <ContextMenuItem
                    key={c}
                    onClick={() => handleToggleCategory(c)}
                    className='flex items-center justify-between'
                  >
                    <div className='flex items-center gap-1.5 truncate'>
                      <div className={`size-1.5 rounded-full ${palette.dot}`} />
                      <span className='truncate'>{c}</span>
                    </div>
                    {isSelected && <Check className='size-3.5' />}
                  </ContextMenuItem>
                )
              })}
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={(e) => {
                  e.preventDefault()
                  setCategoryDialogOpen(true)
                }}
              >
                <Plus className='mr-2 size-3.5' />
                Manage Categories...
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>

          <ContextMenuSeparator />

          <ContextMenuItem onClick={handleCopyLink}>
            <Copy className='mr-2 size-3.5' />
            Copy Link
          </ContextMenuItem>

          <ContextMenuItem onClick={handleDuplicate}>
            <Plus className='mr-2 size-3.5' />
            Duplicate
          </ContextMenuItem>

          <ContextMenuSeparator />

          <ContextMenuItem
            onClick={handleDelete}
            className='text-destructive focus:text-destructive'
          >
            <Trash2 className='mr-2 size-3.5' />
            Move to Trash
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <SetDocCategoryDialog
        open={categoryDialogOpen}
        onOpenChange={setCategoryDialogOpen}
        document={document}
      />

      <RenameDocDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        document={document}
      />

      <MoveDocDialog
        open={moveDialogOpen}
        onOpenChange={setMoveDialogOpen}
        document={document}
      />

      <ConfirmDialog
        open={confirmMoveOpen}
        onOpenChange={setConfirmMoveOpen}
        title='Move document to another project?'
        desc={
          <span>
            This document currently belongs to{' '}
            <strong>&ldquo;{project?.name}&rdquo;</strong>. Moving it to{' '}
            {pendingTargetProjectId ? (
              <strong>&ldquo;{targetProject?.name}&rdquo;</strong>
            ) : (
              'Drafts'
            )}{' '}
            will transfer its ownership. Are you sure you want to continue?
          </span>
        }
        confirmText='Yes, Move Document'
        handleConfirm={handleConfirmMove}
      />
    </>
  )
}
