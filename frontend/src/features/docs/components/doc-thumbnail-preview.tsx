import { useCallback, useMemo, useRef, useState } from 'react'
import { DocType } from '@/types/dokudocs'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { cn } from '@/lib/utils'
import { useTheme } from '@/context/theme-provider'
import {
  generateDbmlThumbnail,
  generateMermaidThumbnail,
} from '../lib/doc-thumbnail-generator'

interface DocThumbnailPreviewProps {
  docId?: string
  type: DocType
  content?: string
  thumbnail?: string | null
  thumbnailDark?: string | null
  className?: string
}

marked.setOptions({
  gfm: true,
  breaks: true,
})

const thumbnailHtmlCache = new Map<string, string>()
const thumbnailSvgCache = new Map<string, string>()
const loadedImageCache = new Set<string>()
const visibleDocCache = new Set<string>()

export function invalidateThumbnailCache(docId?: string) {
  if (!docId) {
    thumbnailHtmlCache.clear()
    thumbnailSvgCache.clear()
    loadedImageCache.clear()
    visibleDocCache.clear()
    return
  }

  for (const key of thumbnailHtmlCache.keys()) {
    if (key.includes(docId)) thumbnailHtmlCache.delete(key)
  }
  for (const key of thumbnailSvgCache.keys()) {
    if (key.includes(docId)) thumbnailSvgCache.delete(key)
  }
  visibleDocCache.delete(docId)
}

function ThumbnailSkeleton({
  type,
  className,
}: {
  type: DocType
  className?: string
}) {
  if (type === 'markdown') {
    return (
      <div
        className={cn(
          'flex h-full w-full animate-pulse flex-col justify-start space-y-2 bg-muted/20 p-3 select-none',
          className
        )}
      >
        <div className='h-2.5 w-1/3 rounded-full bg-blue-500/20' />
        <div className='h-2 w-4/5 rounded-full bg-foreground/15' />
        <div className='h-2 w-3/4 rounded-full bg-foreground/10' />
        <div className='h-2 w-1/2 rounded-full bg-foreground/10' />
        <div className='mt-2 space-y-1 border-l-2 border-blue-500/20 pl-2'>
          <div className='h-1.5 w-2/3 rounded-full bg-foreground/15' />
          <div className='h-1.5 w-1/2 rounded-full bg-foreground/10' />
        </div>
      </div>
    )
  }

  if (type === 'dbdiagram') {
    return (
      <div
        className={cn(
          'flex h-full w-full animate-pulse items-center justify-center gap-2 bg-muted/20 p-2 select-none',
          className
        )}
      >
        <div className='flex w-16 flex-col space-y-1 rounded border border-emerald-500/20 bg-background/50 p-1.5 shadow-2xs'>
          <div className='h-2 w-full rounded bg-emerald-500/30' />
          <div className='h-1 w-full rounded bg-foreground/15' />
          <div className='h-1 w-3/4 rounded bg-foreground/15' />
          <div className='h-1 w-1/2 rounded bg-foreground/10' />
        </div>
        <div className='h-px w-3 bg-emerald-500/30' />
        <div className='flex w-16 flex-col space-y-1 rounded border border-emerald-500/20 bg-background/50 p-1.5 shadow-2xs'>
          <div className='h-2 w-full rounded bg-emerald-500/30' />
          <div className='h-1 w-full rounded bg-foreground/15' />
          <div className='h-1 w-2/3 rounded bg-foreground/10' />
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex h-full w-full animate-pulse items-center justify-center gap-1.5 bg-muted/20 p-2 select-none',
        className
      )}
    >
      <div className='size-5 rounded-full bg-purple-500/20' />
      <div className='h-px w-2.5 bg-purple-500/20' />
      <div className='size-5.5 rounded-md bg-purple-500/30' />
      <div className='h-px w-2.5 bg-purple-500/20' />
      <div className='size-5 rounded-full bg-purple-500/20' />
    </div>
  )
}

export function DocThumbnailPreview({
  docId,
  type,
  content,
  thumbnail,
  thumbnailDark,
  className,
}: DocThumbnailPreviewProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  const activeThumbnail = isDark && thumbnailDark ? thumbnailDark : thumbnail
  const isRasterImage =
    activeThumbnail &&
    (activeThumbnail.startsWith('data:image/') ||
      activeThumbnail.startsWith('http'))

  const docKey = docId || `${type}-${(content || '').slice(0, 32)}`

  const [isVisible, setIsVisible] = useState(() => visibleDocCache.has(docKey))
  const [isImgLoaded, setIsImgLoaded] = useState(() =>
    Boolean(activeThumbnail && loadedImageCache.has(activeThumbnail))
  )
  const observerRef = useRef<IntersectionObserver | null>(null)

  const containerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = null
      }

      if (!node) return

      if (visibleDocCache.has(docKey)) {
        setIsVisible(true)
        return
      }

      if (typeof IntersectionObserver === 'undefined') {
        visibleDocCache.add(docKey)
        setIsVisible(true)
        return
      }

      const observer = new IntersectionObserver(
        (entries) => {
          const [entry] = entries
          if (entry.isIntersecting) {
            visibleDocCache.add(docKey)
            setIsVisible(true)
            observer.disconnect()
          }
        },
        { rootMargin: '200px' }
      )

      observer.observe(node)
      observerRef.current = observer
    },
    [docKey]
  )

  const markdownHtml = useMemo(() => {
    if (!isVisible || type !== 'markdown' || !content?.trim()) return ''
    const cacheKey = `md-${docId || 'temp'}-${content.length}-${content.slice(0, 40)}`
    const cached = thumbnailHtmlCache.get(cacheKey)
    if (cached) return cached

    try {
      const raw = marked.parse(content) as string
      const sanitized = DOMPurify.sanitize(raw)
      thumbnailHtmlCache.set(cacheKey, sanitized)
      return sanitized
    } catch {
      return ''
    }
  }, [isVisible, type, content, docId])

  const dynamicSvg = useMemo(() => {
    if (!isVisible || isRasterImage) return null
    if (activeThumbnail && activeThumbnail.startsWith('<svg')) {
      return activeThumbnail
    }
    if (!content?.trim()) return null

    const cacheKey = `svg-${type}-${docId || 'temp'}-${isDark ? 'dark' : 'light'}-${content.length}-${content.slice(0, 40)}`
    const cached = thumbnailSvgCache.get(cacheKey)
    if (cached) return cached

    let svgResult: string | null = null
    if (type === 'dbdiagram') {
      svgResult = generateDbmlThumbnail(content, docId, isDark)
    } else if (type === 'mermaid') {
      svgResult = generateMermaidThumbnail(content, isDark)
    }

    if (svgResult) {
      thumbnailSvgCache.set(cacheKey, svgResult)
    }
    return svgResult
  }, [isVisible, type, content, activeThumbnail, docId, isDark, isRasterImage])

  const handleImageLoad = useCallback(() => {
    if (activeThumbnail) {
      loadedImageCache.add(activeThumbnail)
    }
    setIsImgLoaded(true)
  }, [activeThumbnail])

  if (!isVisible) {
    return (
      <div
        ref={containerRef}
        className={cn('h-full w-full overflow-hidden', className)}
      >
        <ThumbnailSkeleton type={type} />
      </div>
    )
  }

  if (isRasterImage) {
    return (
      <div
        ref={containerRef}
        className={cn(
          'pointer-events-none relative flex h-full w-full items-center justify-center overflow-hidden bg-card select-none',
          className
        )}
      >
        {!isImgLoaded && (
          <div className='absolute inset-0 z-10'>
            <ThumbnailSkeleton type={type} />
          </div>
        )}
        <img
          src={activeThumbnail}
          alt=''
          onLoad={handleImageLoad}
          className={cn(
            'h-full w-full transform-gpu object-cover object-center transition-opacity duration-150',
            isImgLoaded ? 'opacity-100' : 'opacity-0'
          )}
          loading='lazy'
          decoding='async'
        />
      </div>
    )
  }

  if (type === 'markdown' && markdownHtml) {
    return (
      <div
        ref={containerRef}
        className={cn(
          'pointer-events-none relative h-full w-full overflow-hidden bg-card select-none',
          className
        )}
      >
        <div
          className='h-[270%] w-[270%] origin-top-left scale-[0.37] space-y-2.5 p-4 text-xs leading-relaxed text-foreground [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-blue-500/60 [&_blockquote]:bg-muted/30 [&_blockquote]:px-2.5 [&_blockquote]:py-1 [&_blockquote]:text-muted-foreground [&_blockquote]:italic [&_code]:rounded [&_code]:border [&_code]:border-border/40 [&_code]:bg-muted/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[10px] [&_h1]:mb-2 [&_h1]:border-b [&_h1]:border-border/60 [&_h1]:pb-1.5 [&_h1]:text-xl [&_h1]:font-bold [&_h1]:tracking-tight [&_h1]:text-blue-500 [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:border-b [&_h2]:border-border/40 [&_h2]:pb-1 [&_h2]:text-base [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-blue-500/90 [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-1.5 [&_ol]:ml-4 [&_ol]:list-decimal [&_ol]:space-y-0.5 [&_p]:my-1.5 [&_p]:leading-relaxed [&_p]:text-foreground/90 [&_pre]:my-2 [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border/60 [&_pre]:bg-muted/50 [&_pre]:p-2.5 [&_pre]:font-mono [&_pre]:text-[11px] [&_ul]:my-1.5 [&_ul]:ml-4 [&_ul]:list-disc [&_ul]:space-y-0.5'
          dangerouslySetInnerHTML={{ __html: markdownHtml }}
        />
        <div className='pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card via-card/70 to-transparent' />
      </div>
    )
  }

  if (dynamicSvg) {
    return (
      <div
        ref={containerRef}
        className={cn(
          'pointer-events-none relative flex h-full w-full items-center justify-center overflow-hidden bg-card select-none [&_svg]:h-full [&_svg]:w-full [&_svg]:object-contain',
          className
        )}
        dangerouslySetInnerHTML={{ __html: dynamicSvg }}
      />
    )
  }

  if (type === 'markdown') {
    return (
      <div
        ref={containerRef}
        className={cn(
          'pointer-events-none relative flex h-full w-full flex-col justify-start overflow-hidden bg-gradient-to-b from-blue-500/5 via-muted/20 to-transparent p-2.5 select-none',
          className
        )}
      >
        <div className='mb-1.5 h-2 w-2/5 rounded-full bg-blue-500/40' />
        <div className='mb-1 h-1.5 w-4/5 rounded-full bg-foreground/20' />
        <div className='mb-1 h-1.5 w-3/4 rounded-full bg-foreground/15' />
        <div className='mb-2 h-1.5 w-1/2 rounded-full bg-foreground/15' />
        <div className='space-y-0.5 border-l border-blue-500/40 pl-1.5'>
          <div className='h-1 w-2/3 rounded-full bg-foreground/20' />
          <div className='h-1 w-1/2 rounded-full bg-foreground/15' />
        </div>
      </div>
    )
  }

  if (type === 'dbdiagram') {
    return (
      <div
        ref={containerRef}
        className={cn(
          'pointer-events-none relative flex h-full w-full items-center justify-center gap-1.5 overflow-hidden bg-gradient-to-b from-emerald-500/5 via-muted/20 to-transparent p-2 select-none',
          className
        )}
      >
        <div className='flex w-16 flex-col rounded border border-emerald-500/40 bg-background/90 p-1 shadow-2xs'>
          <div className='mb-1 h-1.5 w-full rounded bg-emerald-500/50' />
          <div className='space-y-0.5'>
            <div className='h-0.5 w-full rounded bg-foreground/25' />
            <div className='h-0.5 w-3/4 rounded bg-foreground/20' />
            <div className='h-0.5 w-1/2 rounded bg-foreground/15' />
          </div>
        </div>

        <div className='h-px w-2.5 bg-emerald-500/60' />

        <div className='flex w-16 flex-col rounded border border-emerald-500/40 bg-background/90 p-1 shadow-2xs'>
          <div className='mb-1 h-1.5 w-full rounded bg-emerald-500/50' />
          <div className='space-y-0.5'>
            <div className='h-0.5 w-full rounded bg-foreground/25' />
            <div className='h-0.5 w-2/3 rounded bg-foreground/20' />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'pointer-events-none relative flex h-full w-full items-center justify-center gap-1 overflow-hidden bg-gradient-to-b from-purple-500/5 via-muted/20 to-transparent p-2 select-none',
        className
      )}
    >
      <div className='flex size-5 items-center justify-center rounded-full border border-purple-500/50 bg-background/90 text-[7px] font-bold text-purple-600 shadow-2xs dark:text-purple-400'>
        A
      </div>
      <div className='h-px w-2 bg-purple-500/50' />
      <div className='flex size-5.5 items-center justify-center rounded-md border border-purple-500/60 bg-background/90 text-[7px] font-bold text-purple-600 shadow-2xs dark:text-purple-400'>
        B
      </div>
      <div className='h-px w-2 bg-purple-500/50' />
      <div className='flex size-5 items-center justify-center rounded-full border border-purple-500/50 bg-background/90 text-[7px] font-bold text-purple-600 shadow-2xs dark:text-purple-400'>
        C
      </div>
    </div>
  )
}
