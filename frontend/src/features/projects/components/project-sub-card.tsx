import { Link } from '@tanstack/react-router'
import { DocumentItem } from '@/types/dokudocs'
import { Database, FileText, GitFork } from 'lucide-react'
import { DocThumbnailPreview } from '@/features/docs/components/doc-thumbnail-preview'

interface ProjectSubCardProps {
  document: DocumentItem
}

export function ProjectSubCard({ document }: ProjectSubCardProps) {
  const icons = {
    markdown: FileText,
    dbdiagram: Database,
    mermaid: GitFork,
  }

  const colors = {
    markdown:
      'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    dbdiagram:
      'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    mermaid:
      'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
  }

  const Icon = icons[document.type] || FileText
  const badgeStyle = colors[document.type] || colors.markdown

  return (
    <Link
      to='/docs/$docId'
      params={{ docId: document.id }}
      className='group/sub relative flex h-24 transform-gpu flex-col overflow-hidden rounded-lg border border-border/70 bg-background transition-[transform,box-shadow,border-color] duration-150 ease-out will-change-transform hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-xs'
    >
      <div className='relative min-h-0 w-full flex-1 overflow-hidden border-b border-border/40 bg-muted/20'>
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
        <div
          className={`absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded border backdrop-blur-xs ${badgeStyle}`}
        >
          <Icon className='size-3' />
        </div>
      </div>

      <div className='shrink-0 bg-background/95 px-2 py-1.5'>
        <p className='truncate text-[11px] font-medium tracking-tight text-foreground/90 transition-colors group-hover/sub:text-primary'>
          {document.title}
        </p>
      </div>
    </Link>
  )
}
