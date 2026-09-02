import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import type { DocType } from '@/types/dokudocs'
import {
  ArrowLeft,
  CheckCircle2,
  Code,
  Copy,
  Download,
  FileCode,
  Folder,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Share2,
  Tag,
} from 'lucide-react'
import { toast } from 'sonner'
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

interface EditorHeaderProps {
  docId: string
  title: string
  type: DocType
  projectId: string | null
  category?: string | null
  categories?: string[]
  isSaving: boolean
  isDirty: boolean
  lastSaved: Date | null
  onTitleChange: (newTitle: string) => void
  onExportDiagram?: () => void
  onExportCode?: () => void
  onExportCopySvg?: () => void
  onExportSvg?: () => void
  onExportPng?: () => void
  onToggleComments?: () => void
  isCommentsOpen?: boolean
  commentsCount?: number
}

export function EditorHeader({
  docId,
  title,
  type,
  projectId,
  category,
  categories,
  isSaving,
  isDirty,
  lastSaved,
  onTitleChange,
  onExportDiagram,
  onExportCode,
  onExportCopySvg,
  onExportSvg,
  onExportPng,
  onToggleComments,
  isCommentsOpen,
  commentsCount,
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

  const handleShare = () => {
    navigator.clipboard.writeText(`${window.location.origin}/docs/${docId}`)
    toast.success('Document share link copied to clipboard')
  }

  const handleBack = () => {
    if (window.history.length > 1 && window.history.state?.idx !== 0) {
      window.history.back()
    } else if (activeProject) {
      navigate({
        to: '/projects/$projectId',
        params: { projectId: activeProject.id },
      })
    } else {
      navigate({ to: '/' })
    }
  }

  return (
    <header className='sticky top-0 z-40 flex h-14 w-full items-center justify-between border-b border-border/80 bg-background/95 px-4 backdrop-blur-md'>
      <div className='flex min-w-0 flex-1 items-center gap-3'>
        <Button
          variant='ghost'
          size='icon'
          className='size-8 shrink-0'
          onClick={handleBack}
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
              onClick={() => {
                setTempTitle(title)
                setIsEditingTitle(true)
              }}
              className='cursor-pointer truncate text-sm font-semibold tracking-tight text-foreground transition-colors hover:text-primary'
            >
              {title}
            </h1>
          )}
        </div>

        <div className='flex shrink-0 items-center gap-1.5 pl-1 text-[11px] font-medium'>
          {isSaving ? (
            <span className='flex items-center gap-1 text-amber-500'>
              <Loader2 className='size-3 animate-spin' />
              <span className='hidden sm:inline'>Saving...</span>
            </span>
          ) : isDirty ? (
            <span className='text-muted-foreground/70'>Unsaved</span>
          ) : (
            <span
              className='flex items-center gap-1 text-emerald-600 dark:text-emerald-400'
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
          <Link
            to='/projects/$projectId'
            params={{ projectId: activeProject.id }}
            className='hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground xl:flex'
          >
            <Folder className='size-3.5 shrink-0 text-muted-foreground/70' />
            <span className='max-w-36 truncate font-medium'>
              {activeProject.name}
            </span>
          </Link>
        ) : (
          <span className='hidden items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground/80 xl:flex'>
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
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${palette.bg} ${palette.text} ${palette.border}`}
                  >
                    <Tag className='size-2.5 shrink-0' />
                    <span>{firstCat}</span>
                  </span>
                  {remainingCount > 0 && (
                    <span
                      title={docCategories.slice(1).join(', ')}
                      className='rounded-full border border-border/80 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground'
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
              <span className='flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground'>
                {commentsCount}
              </span>
            )}
          </Button>
        )}

        <Button
          variant='outline'
          size='sm'
          onClick={handleShare}
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
                  <Code className='size-3.5 text-purple-500' />
                  <span>Copy SVG Code</span>
                </DropdownMenuItem>
              )}
              {onExportSvg && (
                <DropdownMenuItem onClick={onExportSvg} className='gap-2 text-xs'>
                  <FileCode className='size-3.5 text-blue-500' />
                  <span>Download as SVG</span>
                </DropdownMenuItem>
              )}
              {onExportPng && (
                <DropdownMenuItem onClick={onExportPng} className='gap-2 text-xs'>
                  <ImageIcon className='size-3.5 text-emerald-500' />
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
