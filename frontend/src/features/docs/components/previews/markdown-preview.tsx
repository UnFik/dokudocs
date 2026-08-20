import React, { memo, useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

interface MarkdownPreviewProps {
  content: string
  scrollRef?: React.RefObject<HTMLDivElement | null>
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void
}

marked.setOptions({
  gfm: true,
  breaks: true,
})

function MarkdownPreviewInner({
  content,
  scrollRef,
  onScroll,
}: MarkdownPreviewProps) {
  const html = useMemo(() => {
    if (!content.trim()) return ''
    const raw = marked.parse(content) as string
    return DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['target', 'rel'],
    })
  }, [content])

  if (!content.trim()) {
    return (
      <div className='flex h-full min-h-[300px] flex-col items-center justify-center text-xs text-muted-foreground'>
        <p className='italic'>Empty markdown document</p>
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className='h-full w-full overflow-y-auto bg-background p-6 select-text'
    >
      <div
        className='max-w-3xl mx-auto pb-16 text-foreground text-xs leading-relaxed space-y-3
        [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:tracking-tight [&_h1]:border-b [&_h1]:border-border/60 [&_h1]:pb-2 [&_h1]:mt-6 [&_h1]:mb-3
        [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:border-b [&_h2]:border-border/40 [&_h2]:pb-1.5 [&_h2]:mt-5 [&_h2]:mb-2.5
        [&_h3]:text-base [&_h3]:font-semibold [&_h3]:tracking-tight [&_h3]:mt-4 [&_h3]:mb-2
        [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:mt-3 [&_h4]:mb-1.5
        [&_h5]:text-xs [&_h5]:font-semibold [&_h5]:uppercase [&_h5]:tracking-wider [&_h5]:mt-2.5 [&_h5]:mb-1
        [&_h6]:text-xs [&_h6]:font-semibold [&_h6]:text-muted-foreground [&_h6]:uppercase [&_h6]:tracking-wider [&_h6]:mt-2 [&_h6]:mb-1
        [&_p]:my-2 [&_p]:leading-relaxed [&_p]:text-foreground/90
        [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-3 hover:[&_a]:text-primary/80
        [&_strong]:font-semibold [&_strong]:text-foreground
        [&_em]:italic [&_em]:text-foreground/90
        [&_del]:line-through [&_del]:text-muted-foreground
        [&_ul]:my-2 [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1
        [&_ol]:my-2 [&_ol]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-1
        [&_li]:my-0.5 [&_li]:leading-relaxed
        [&_blockquote]:my-3 [&_blockquote]:border-l-3 [&_blockquote]:border-primary/60 [&_blockquote]:bg-muted/30 [&_blockquote]:px-3.5 [&_blockquote]:py-2 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_blockquote]:rounded-r-md
        [&_hr]:my-6 [&_hr]:border-border/60
        [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_table]:text-xs [&_table]:rounded-lg [&_table]:border [&_table]:border-border/80 [&_table]:shadow-2xs
        [&_thead]:border-b [&_thead]:border-border/80 [&_thead]:bg-muted/60 [&_thead]:font-semibold [&_thead]:text-foreground
        [&_tbody]:divide-y [&_tbody]:divide-border/40 [&_tbody]:bg-background
        [&_tr]:hover:bg-muted/30 [&_tr]:transition-colors
        [&_th]:px-3.5 [&_th]:py-2.5 [&_th]:font-semibold [&_th]:text-foreground [&_th]:border [&_th]:border-border/60
        [&_td]:px-3.5 [&_td]:py-2 [&_td]:text-foreground/90 [&_td]:border [&_td]:border-border/40
        [&_pre]:my-3.5 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border/80 [&_pre]:bg-muted/50 [&_pre]:p-3.5 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-5 [&_pre]:shadow-2xs
        [&_code]:rounded-md [&_code]:border [&_code]:border-border/60 [&_code]:bg-muted/60 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px] [&_code]:text-foreground
        [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-xs
        [&_img]:my-3 [&_img]:max-h-96 [&_img]:rounded-lg [&_img]:border [&_img]:border-border/80 [&_img]:shadow-xs [&_img]:object-contain
        [&_input[type="checkbox"]]:mr-1.5 [&_input[type="checkbox"]]:size-3.5 [&_input[type="checkbox"]]:rounded [&_input[type="checkbox"]]:border-border [&_input[type="checkbox"]]:text-primary [&_input[type="checkbox"]]:align-middle'
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

export const MarkdownPreview = memo(MarkdownPreviewInner)
