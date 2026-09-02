import { useCallback } from 'react'
import {
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Workflow,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useTheme } from '@/context/theme-provider'
import { Button } from '@/components/ui/button'
import { useCanvasPanZoom } from '../../hooks/use-canvas-pan-zoom'
import { useMermaidRender } from '../../hooks/use-mermaid-render'

interface MermaidPreviewProps {
  docId?: string
  content: string
}

export function MermaidPreview({ docId, content }: MermaidPreviewProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const { svg, error, isValid, isRendering } = useMermaidRender(
    content,
    isDark,
    docId
  )

  const {
    viewportRef,
    canvasLayerRef,
    zoomBadgeRef,
    isPanning,
    initialPan,
    initialZoom,
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

    const padding = 40
    const scaleX = (viewportRect.width - padding * 2) / rawWidth
    const scaleY = (viewportRect.height - padding * 2) / rawHeight
    const nextZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.1), 12)

    const nextPanX = (viewportRect.width - rawWidth * nextZoom) / 2
    const nextPanY = (viewportRect.height - rawHeight * nextZoom) / 2

    setPanAndZoom({ x: nextPanX, y: nextPanY }, nextZoom)
  }, [setPanAndZoom, viewportRef, canvasLayerRef, zoomRef])

  const singleLineError = error
    ? error.split('\n')[0].replace(/^Error:\s*/i, '')
    : ''

  return (
    <div className='relative flex h-full w-full flex-col overflow-hidden bg-background select-none [background-size:24px_24px] [background-image:radial-gradient(circle,rgba(0,0,0,0.06)_1.5px,transparent_1.5px)] dark:[background-image:radial-gradient(circle,rgba(255,255,255,0.07)_1.5px,transparent_1.5px)]'>
      <div className='absolute top-3 right-3 z-30 flex items-center gap-1.5 rounded-lg border border-border/80 bg-background/95 p-1 shadow-md backdrop-blur-md'>
        {isRendering && (
          <>
            <div className='flex animate-pulse items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-purple-600 dark:text-purple-400'>
              <span className='size-1.5 rounded-full bg-purple-500' />
              <span>Rendering</span>
            </div>
            <div className='mx-0.5 h-4 w-px bg-border/60' />
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
        <div className='mx-0.5 h-4 w-px bg-border/60' />
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
          className='min-w-10 px-1 text-center font-mono text-[10px] font-semibold text-muted-foreground'
        >
          {Math.round(initialZoom * 100)}%
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
        <div className='absolute top-14 right-4 left-4 z-20 flex animate-in items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-600 shadow-lg backdrop-blur-md duration-150 fade-in dark:text-amber-400'>
          <div className='flex min-w-0 items-center gap-2'>
            <AlertTriangle className='size-4 shrink-0' />
            <span className='truncate font-mono font-medium'>
              {singleLineError}
            </span>
          </div>
          {svg ? (
            <span className='shrink-0 font-sans text-[10px] text-amber-600/80 dark:text-amber-400/80'>
              Showing last valid preview
            </span>
          ) : (
            <span className='shrink-0 font-sans text-[10px] font-medium text-amber-600/80 dark:text-amber-400/80'>
              Syntax Error
            </span>
          )}
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
              <p className='font-medium text-foreground'>
                Mermaid Live Diagram Engine
              </p>
              <p className='mt-1 max-w-sm text-[11px] text-muted-foreground'>
                Type standard Mermaid diagrams (Sequence Diagram, Flowchart,
                Class Diagram, ERD, State Diagram) in the editor to render live.
              </p>
            </div>
          </div>
        ) : !isValid && !svg ? (
          <div className='flex h-full min-h-[300px] flex-col items-center justify-center gap-4 p-6 text-center text-xs select-text'>
            <div className='flex size-12 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-500 shadow-sm'>
              <AlertTriangle className='size-6' />
            </div>
            <div className='max-w-md space-y-1.5'>
              <p className='text-sm font-semibold text-foreground'>
                Mermaid Syntax Error
              </p>
              <p className='text-[11px] text-muted-foreground'>
                The diagram cannot be rendered because the Mermaid code contains
                invalid syntax.
              </p>
            </div>
            {error && (
              <div className='max-h-56 w-full max-w-xl overflow-auto rounded-lg border border-amber-500/20 bg-amber-500/5 p-3.5 text-left font-mono text-[11px] leading-relaxed text-amber-600 shadow-inner select-text dark:text-amber-400'>
                <pre className='font-mono break-all whitespace-pre-wrap'>
                  {error}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <div
            ref={canvasLayerRef}
            id='mermaid-canvas-layer'
            className='absolute inset-0 size-full overflow-visible p-8'
            style={{
              transform: `translate3d(${initialPan.x}px, ${initialPan.y}px, 0) scale(${initialZoom})`,
              transformOrigin: '0 0',
              willChange: 'transform',
            }}
          >
            <div
              className={`pointer-events-auto inline-block transition-opacity duration-200 select-text [&_svg]:h-auto [&_svg]:max-w-none dark:[&_text.messageText]:fill-slate-100 dark:[&_text.actor]:fill-slate-100 dark:[&_text.labelText]:fill-slate-100 dark:[&_text.loopText]:fill-slate-100 dark:[&_line.messageLine0]:stroke-slate-300 dark:[&_line.messageLine1]:stroke-slate-300 dark:[&_path.messageLine0]:stroke-slate-300 dark:[&_path.messageLine1]:stroke-slate-300 dark:[&_.sequenceNumber]:fill-slate-100 ${
                !isValid ? 'opacity-70' : 'opacity-100'
              }`}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
