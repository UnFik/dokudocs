import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { DocType } from '@/types/dokudocs'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Code,
  Copy,
  Download,
  FileCode,
  Folder,
  History,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Share2,
  Star,
  Tag,
} from 'lucide-react'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { getCategoryPalette } from '@/lib/category-palette'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { DocTypeBadge } from './doc-type-badge'
import { ProjectDocsHoverCard } from './project-docs-hover-card'

interface EditorHeaderProps {
  docId: string
  title: string
  type: DocType
  projectId: string | null
  projectName?: string | null
  category?: string | null
  categories?: string[]
  isSaving: boolean
  isDirty: boolean
  lastSaved: Date | null
  onTitleChange: (newTitle: string) => void
  titleReadOnly?: boolean
  onExportDiagram?: () => void
  onExportCode?: () => void
  onExportCopySvg?: () => void
  onExportSvg?: () => void
  onExportPng?: () => void
  onToggleComments?: () => void
  isCommentsOpen?: boolean
  commentsCount?: number
  onToggleHistory?: () => void
  isHistoryOpen?: boolean
  onOpenShare?: () => void
  isStarred?: boolean
  onToggleStar?: () => void
}

export function EditorHeader({
  docId,
  title,
  type,
  projectId,
  projectName,
  category,
  categories,
  isSaving,
  isDirty,
  lastSaved,
  onTitleChange,
  titleReadOnly = false,
  onExportDiagram,
  onExportCode,
  onExportCopySvg,
  onExportSvg,
  onExportPng,
  onToggleComments,
  isCommentsOpen,
  commentsCount,
  onToggleHistory,
  isHistoryOpen,
  onOpenShare,
  isStarred,
  onToggleStar,
}: EditorHeaderProps) {
  const navigate = useNavigate()
  const { projects } = useDokudocsStore()
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [tempTitle, setTempTitle] = useState(title)

  const activeProject = projects.find((p) => p.id === projectId)
  const docCategories = categories?.length
    ? categories
    : category
      ? [category]
      : []

  const handleTitleSubmit = () => {
    setIsEditingTitle(false)
    if (tempTitle.trim()) {
      onTitleChange(tempTitle.trim())
    } else {
      setTempTitle(title)
    }
  }

  const handleBack = () => {
    if (activeProject) {
      navigate({
        to: '/projects/$projectId',
        params: { projectId: activeProject.id },
      })
    } else {
      navigate({ to: '/' })
    }
  }

  return (
    <header className='sticky top-0 z-40 flex h-14 w-full items-center justify-between border-b border-border/80 bg-background/95 px-4'>
      <div className='flex min-w-0 flex-1 items-center gap-3'>
        <Button
          variant='ghost'
          size='icon'
          className='size-8 shrink-0'
          onClick={handleBack}
          aria-label='Back'
        >
          <ArrowLeft className='size-4' />
        </Button>

        <DocTypeBadge type={type} className='shrink-0' />

        <div className='flex max-w-sm min-w-0 items-center gap-2 sm:max-w-md'>
          {isEditingTitle ? (
            <Input
              value={tempTitle}
              onChange={(e) => setTempTitle(e.target.value)}
              onBlur={handleTitleSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTitleSubmit()
                if (e.key === 'Escape') {
                  setTempTitle(title)
                  setIsEditingTitle(false)
                }
              }}
              className='h-7 w-64 text-sm font-semibold'
              autoFocus
            />
          ) : (
            <h1
              onClick={
                titleReadOnly
                  ? undefined
                  : () => {
                      setTempTitle(title)
                      setIsEditingTitle(true)
                    }
              }
              className={`truncate text-sm font-semibold tracking-tight text-foreground ${titleReadOnly ? '' : 'cursor-pointer transition-colors hover:text-primary'}`}
            >
              {title}
            </h1>
          )}
        </div>

        <div className='flex shrink-0 items-center gap-1.5 pl-1 text-[11px] font-medium'>
          {isSaving ? (
            <span className='flex items-center gap-1 text-muted-foreground'>
              <Loader2 className='size-3 animate-spin' />
              <span className='hidden sm:inline'>Saving...</span>
            </span>
          ) : isDirty ? (
            <span className='flex items-center gap-1.5 text-warn'>
              <i className='size-1.5 rounded-[1px] bg-warn' aria-hidden='true' />
              Unsaved
            </span>
          ) : (
            <span
              className='flex items-center gap-1 text-ok'
              title={
                lastSaved
                  ? `Last saved at ${lastSaved.toLocaleTimeString()}`
                  : 'Saved'
              }
            >
              <CheckCircle2 className='size-3' />
              <span className='hidden sm:inline'>Saved</span>
            </span>
          )}
        </div>
      </div>

      <div className='flex items-center gap-2 text-xs text-muted-foreground'>
        {activeProject ? (
          <ProjectDocsHoverCard
            projectId={activeProject.id}
            currentDocId={docId}
          >
            <button
              type='button'
              className='hidden cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground md:flex'
            >
              <Folder className='size-3.5 shrink-0 text-muted-foreground/70' />
              <span className='max-w-36 truncate font-medium'>
                {activeProject.name}
              </span>
              <ChevronDown className='size-3 shrink-0 opacity-60' />
            </button>
          </ProjectDocsHoverCard>
        ) : projectName ? (
          <span className='hidden items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground/80 md:flex'>
            <Folder className='size-3.5 shrink-0' />
            <span className='max-w-36 truncate'>{projectName}</span>
          </span>
        ) : (
          <span className='hidden items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground/80 md:flex'>
            <Folder className='size-3.5 shrink-0' />
            <span>Draft</span>
          </span>
        )}

        <div className='hidden flex-wrap items-center gap-1.5 2xl:flex'>
          {docCategories.length > 0 &&
            (() => {
              const firstCat = docCategories[0]
              const colorId = activeProject?.categoryColors?.[firstCat]
              const palette = getCategoryPalette(firstCat, colorId, 0)
              const remainingCount = docCategories.length - 1

              return (
                <>
                  <span
                    className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-medium ${palette.bg} ${palette.text} ${palette.border}`}
                  >
                    <Tag className='size-2.5 shrink-0' />
                    <span>{firstCat}</span>
                  </span>
                  {remainingCount > 0 && (
                    <span
                      title={docCategories.slice(1).join(', ')}
                      className='rounded-sm border border-border/80 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground'
                    >
                      +{remainingCount}
                    </span>
                  )}
                </>
              )
            })()}
        </div>

        {onToggleComments && (
          <Button
            variant={isCommentsOpen ? 'secondary' : 'outline'}
            size='sm'
            onClick={onToggleComments}
            className={`relative h-8 gap-1.5 text-xs ${
              isCommentsOpen
                ? 'border-primary/30 bg-primary/10 font-medium text-primary'
                : ''
            }`}
            title='Comments'
          >
            <MessageSquare className='size-3.5' />
            <span className='hidden md:inline'>Comments</span>
            {typeof commentsCount === 'number' && commentsCount > 0 && (
              <span className='flex h-4 min-w-4 items-center justify-center rounded-sm bg-primary px-1 text-[10px] font-semibold text-primary-foreground'>
                {commentsCount}
              </span>
            )}
          </Button>
        )}

        {onToggleStar && (
          <Button
            variant='outline'
            size='icon'
            onClick={onToggleStar}
            className='size-8 shrink-0'
            title={isStarred ? 'Unstar Document' : 'Star Document'}
            aria-label={isStarred ? 'Unstar Document' : 'Star Document'}
          >
            <Star
              className={`size-3.5 ${
                isStarred
                  ? 'fill-foreground text-foreground'
                  : 'text-muted-foreground/70'
              }`}
            />
          </Button>
        )}

        {onToggleHistory && (
          <Button
            variant={isHistoryOpen ? 'secondary' : 'outline'}
            size='icon'
            onClick={onToggleHistory}
            className={`size-8 shrink-0 ${
              isHistoryOpen
                ? 'border-primary/30 bg-primary/10 font-medium text-primary'
                : ''
            }`}
            title='Version History'
            aria-label='Version History'
          >
            <History className='size-3.5' />
          </Button>
        )}

        <Button
          variant='outline'
          size='sm'
          onClick={onOpenShare}
          disabled={!onOpenShare}
          title={onOpenShare ? 'Share document' : 'Sharing is unavailable'}
          className='h-8 gap-1.5 text-xs'
        >
          <Share2 className='size-3.5' />
          <span className='hidden sm:inline'>Share</span>
        </Button>

        {onExportDiagram ? (
          <Button
            size='sm'
            onClick={onExportDiagram}
            className='h-8 gap-1.5 text-xs'
          >
            <Download className='size-3.5' />
            <span>Export</span>
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size='sm' className='h-8 gap-1.5 text-xs'>
                <Download className='size-3.5' />
                <span>Export</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-48'>
              {onExportCode && (
                <DropdownMenuItem
                  onClick={onExportCode}
                  className='gap-2 text-xs'
                >
                  <Copy className='size-3.5' />
                  <span>Copy Raw Code</span>
                </DropdownMenuItem>
              )}
              {onExportCopySvg && (
                <DropdownMenuItem
                  onClick={onExportCopySvg}
                  className='gap-2 text-xs'
                >
                  <Code className='size-3.5 text-muted-foreground' />
                  <span>Copy SVG Code</span>
                </DropdownMenuItem>
              )}
              {onExportSvg && (
                <DropdownMenuItem
                  onClick={onExportSvg}
                  className='gap-2 text-xs'
                >
                  <FileCode className='size-3.5 text-muted-foreground' />
                  <span>Download as SVG</span>
                </DropdownMenuItem>
              )}
              {onExportPng && (
                <DropdownMenuItem
                  onClick={onExportPng}
                  className='gap-2 text-xs'
                >
                  <ImageIcon className='size-3.5 text-muted-foreground' />
                  <span>Download as PNG</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  )
}
