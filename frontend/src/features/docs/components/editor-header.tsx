import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
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
  Share2,
  Tag,
} from 'lucide-react'
import { toast } from 'sonner'
import { DocType } from '@/types/dokudocs'
import { getCategoryPalette } from '@/lib/category-palette'
import { useDokudocsStore } from '@/stores/dokudocs-store'
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
  onExportCode?: () => void
  onExportCopySvg?: () => void
  onExportSvg?: () => void
  onExportPng?: () => void
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
  onExportCode,
  onExportCopySvg,
  onExportSvg,
  onExportPng,
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
      <div className='flex items-center gap-3 min-w-0 flex-1'>
        <Button
          variant='ghost'
          size='icon'
          className='size-8 shrink-0'
          onClick={handleBack}
        >
          <ArrowLeft className='size-4' />
        </Button>

        <DocTypeBadge type={type} className='shrink-0' />

        <div className='flex items-center gap-2 min-w-0 flex-1'>
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
              className='cursor-pointer truncate text-sm font-semibold tracking-tight text-foreground hover:text-primary transition-colors'
            >
              {title}
            </h1>
          )}
        </div>
      </div>

      <div className='flex items-center gap-3 text-xs text-muted-foreground'>
        {activeProject ? (
          <Link
            to='/projects/$projectId'
            params={{ projectId: activeProject.id }}
            className='hidden md:flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors'
          >
            <Folder className='size-3.5 shrink-0 text-muted-foreground/70' />
            <span className='max-w-36 truncate font-medium'>
              {activeProject.name}
            </span>
          </Link>
        ) : (
          <span className='hidden md:flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground/80'>
            <Folder className='size-3.5 shrink-0' />
            <span>Draft</span>
          </span>
        )}

        <div className='hidden lg:flex items-center gap-1.5 flex-wrap'>
          {docCategories.length > 0 && (() => {
            const firstCat = docCategories[0]
            const colorId = activeProject?.categoryColors?.[firstCat]
            const palette = getCategoryPalette(firstCat, colorId, 0)
            const remainingCount = docCategories.length - 1

            return (
              <>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border ${palette.bg} ${palette.text} ${palette.border}`}
                >
                  <Tag className='size-2.5 shrink-0' />
                  <span>{firstCat}</span>
                </span>
                {remainingCount > 0 && (
                  <span
                    title={docCategories.slice(1).join(', ')}
                    className='rounded-full px-1.5 py-0.5 text-[10px] font-medium border border-border/80 bg-muted/60 text-muted-foreground'
                  >
                    +{remainingCount}
                  </span>
                )}
              </>
            )
          })()}
        </div>

        <div className='flex items-center gap-1.5 w-24 justify-end text-[11px] font-medium'>
          {isSaving ? (
            <span className='flex items-center gap-1 text-amber-500'>
              <Loader2 className='size-3 animate-spin' />
              <span>Saving...</span>
            </span>
          ) : isDirty ? (
            <span className='text-muted-foreground/70'>Unsaved</span>
          ) : (
            <span
              className='flex items-center gap-1 text-emerald-600 dark:text-emerald-400'
              title={lastSaved ? `Last saved at ${lastSaved.toLocaleTimeString()}` : 'Saved'}
            >
              <CheckCircle2 className='size-3' />
              <span>Saved</span>
            </span>
          )}
        </div>

        <Button
          variant='outline'
          size='sm'
          onClick={handleShare}
          className='h-8 text-xs gap-1.5'
        >
          <Share2 className='size-3.5' />
          <span className='hidden sm:inline'>Share</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size='sm' className='h-8 text-xs gap-1.5'>
              <Download className='size-3.5' />
              <span>Export</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-48'>
            {onExportCode && (
              <DropdownMenuItem onClick={onExportCode} className='text-xs gap-2'>
                <Copy className='size-3.5' />
                <span>Copy Raw Code</span>
              </DropdownMenuItem>
            )}
            {onExportCopySvg && (
              <DropdownMenuItem onClick={onExportCopySvg} className='text-xs gap-2'>
                <Code className='size-3.5 text-purple-500' />
                <span>Copy SVG Code</span>
              </DropdownMenuItem>
            )}
            {onExportSvg && (
              <DropdownMenuItem onClick={onExportSvg} className='text-xs gap-2'>
                <FileCode className='size-3.5 text-blue-500' />
                <span>Download as SVG</span>
              </DropdownMenuItem>
            )}
            {onExportPng && (
              <DropdownMenuItem onClick={onExportPng} className='text-xs gap-2'>
                <ImageIcon className='size-3.5 text-emerald-500' />
                <span>Download as PNG</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
