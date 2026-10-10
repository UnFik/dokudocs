import { Link } from '@tanstack/react-router'
import type { DocumentItem } from '@/types/dokudocs'
import { getDocumentType } from '@/lib/document-types'
import { DocThumbnailPreview } from '@/features/docs/components/doc-thumbnail-preview'

interface ProjectSubCardProps {
  document: DocumentItem
}

export function ProjectSubCard({ document }: ProjectSubCardProps) {
  const Icon = getDocumentType(document.type).icon

  return (
    <Link
      to='/docs/$docId'
      params={{ docId: document.id }}
      className='group/sub relative flex h-24 transform-gpu flex-col overflow-hidden rounded-lg border border-border/70 bg-background transition-[transform,box-shadow,border-color] duration-150 ease-out will-change-transform hover:-translate-y-0.5 hover:border-primary/60'
    >
      <div className='relative min-h-0 w-full flex-1 overflow-hidden border-b border-border/40 bg-muted/20'>
        <DocThumbnailPreview
          docId={document.id}
          workspaceID={document.workspaceId}
          type={document.type}
          content={document.content}
          thumbnail={document.thumbnail || document.thumbnailPreview}
          thumbnailDark={
            document.thumbnailDark || document.thumbnailPreviewDark
          }
          className='h-full w-full'
        />
        <div className='absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded border border-border bg-muted text-foreground'>
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
