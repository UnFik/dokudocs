import { useCallback } from 'react'
import {
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Workflow,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useCanvasPanZoom } from '../../hooks/use-canvas-pan-zoom'
import { useMermaidRender } from '../../hooks/use-mermaid-render'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/context/theme-provider'

interface MermaidPreviewProps {
  docId?: string
  content: string
}

export function MermaidPreview({ docId, content }: MermaidPreviewProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const { svg, error, isValid, isRendering } = useMermaidRender(content, isDark)

  const {
    viewportRef,
    canvasLayerRef,
    zoomBadgeRef,
    isPanning,
    panRef,
    zoomRef,
    handleZoomIn,
    handleZoomOut,
    handleResetView,
    handleMouseDownBackground,
    setPanAndZoom,
  } = useCanvasPanZoom({
    docId,
    initialPan: { x: 40, y: 40 },
    initialZoom: 1,
    storagePrefix: 'dokudocs_mermaid_layout_',
  })

  const handleFitToView = useCallback(() => {
    const viewport = viewportRef.current
    const canvasLayer = canvasLayerRef.current
    if (!viewport || !canvasLayer) return

    const svgElement = canvasLayer.querySelector('svg')
    if (!svgElement) return

    const svgRect = svgElement.getBoundingClientRect()
    const viewportRect = viewport.getBoundingClientRect()

    const currentZoom = zoomRef.current
    const rawWidth = svgRect.width / currentZoom
    const rawHeight = svgRect.height / currentZoom

    if (rawWidth <= 0 || rawHeight <= 0) return

    const padding = 60
    const scaleX = (viewportRect.width - padding * 2) / rawWidth
    const scaleY = (viewportRect.height - padding * 2) / rawHeight
    const nextZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.2), 2.5)

    const nextPanX = Math.max(20, (viewportRect.width - rawWidth * nextZoom) / 2)
    const nextPanY = Math.max(20, (viewportRect.height - rawHeight * nextZoom) / 2)

    setPanAndZoom({ x: nextPanX, y: nextPanY }, nextZoom)
  }, [setPanAndZoom, viewportRef, canvasLayerRef, zoomRef])

  return (
    <div className='relative flex h-full w-full flex-col overflow-hidden bg-muted/15 select-none'>
      <div className='absolute top-3 right-3 z-30 flex items-center gap-1.5 rounded-lg border border-border/80 bg-background/95 p-1 shadow-md backdrop-blur-md'>
        {isRendering && (
          <>
            <div className='flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-purple-600 dark:text-purple-400 animate-pulse'>
              <span className='size-1.5 rounded-full bg-purple-500' />
              <span>Rendering</span>
            </div>
            <div className='h-4 w-px bg-border/60 mx-0.5' />
          </>
        )}
        <Button
          variant='ghost'
          size='sm'
          className='h-7 gap-1 px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground'
          onClick={handleFitToView}
          title='Fit diagram into screen'
        >
          <Sparkles className='size-3.5 text-purple-500' />
          <span>Fit View</span>
        </Button>
        <div className='h-4 w-px bg-border/60 mx-0.5' />
        <Button
          variant='ghost'
          size='icon'
          className='size-7'
          onClick={handleZoomIn}
          title='Zoom in'
        >
          <ZoomIn className='size-3.5' />
        </Button>
        <span
          ref={zoomBadgeRef}
          className='px-1 font-mono text-[10px] font-semibold text-muted-foreground min-w-10 text-center'
        >
          {Math.round(zoomRef.current * 100)}%
        </span>
        <Button
          variant='ghost'
          size='icon'
          className='size-7'
          onClick={handleZoomOut}
          title='Zoom out'
        >
          <ZoomOut className='size-3.5' />
        </Button>
        <Button
          variant='ghost'
          size='icon'
          className='size-7'
          onClick={handleResetView}
          title='Reset zoom & pan'
        >
          <RotateCcw className='size-3.5' />
        </Button>
      </div>

      {!isValid && error && (
        <div className='absolute top-14 left-4 right-4 z-20 flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-600 dark:text-amber-400 shadow-lg backdrop-blur-md animate-in fade-in duration-150'>
          <div className='flex items-center gap-2 min-w-0'>
            <AlertTriangle className='size-4 shrink-0' />
            <span className='font-mono font-medium truncate'>
              {error.replace(/^Error:\s*/, '')}
            </span>
          </div>
          <span className='text-[10px] text-amber-600/80 dark:text-amber-400/80 shrink-0 font-sans'>
            Showing last valid preview
          </span>
        </div>
      )}

      <div
        ref={viewportRef}
        onMouseDown={handleMouseDownBackground}
        className={`relative flex-1 overflow-hidden ${
          isPanning ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        {!content.trim() ? (
          <div className='flex h-full min-h-[300px] flex-col items-center justify-center gap-3 p-6 text-center text-xs text-muted-foreground'>
            <div className='flex size-12 items-center justify-center rounded-2xl border border-purple-500/20 bg-purple-500/10 text-purple-500 shadow-sm'>
              <Workflow className='size-6' />
            </div>
            <div>
              <p className='font-medium text-foreground'>Mermaid Live Diagram Engine</p>
              <p className='mt-1 text-[11px] text-muted-foreground max-w-sm'>
                Type standard Mermaid diagrams (Sequence Diagram, Flowchart, Class Diagram, ERD, State Diagram) in the editor to render live.
              </p>
            </div>
          </div>
        ) : (
          <div
            ref={canvasLayerRef}
            id='mermaid-canvas-layer'
            className='absolute inset-0 size-full overflow-visible p-8'
            style={{
              transform: `translate3d(${panRef.current.x}px, ${panRef.current.y}px, 0) scale(${zoomRef.current})`,
              transformOrigin: '0 0',
              willChange: 'transform',
            }}
          >
            <div
              className='inline-block pointer-events-auto filter drop-shadow-sm select-text [&_svg]:max-w-none [&_svg]:h-auto'
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
