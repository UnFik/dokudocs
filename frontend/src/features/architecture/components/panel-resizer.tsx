import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '@/lib/utils'
import { panelWidth, panelWidths, type SidePanel } from '../lib/panel-width'

const STEP = 16
const BIG_STEP = 64

/**
 * The edge between a side panel and the canvas. Dragging it, or the arrow keys
 * when it has focus, change the panel's width; a double click puts it back.
 * `onResize` follows every move, `onCommit` gets the width once it settles.
 */
export function PanelResizer(props: {
  side: SidePanel
  width: number
  onResize: (width: number) => void
  onCommit: (width: number) => void
  className?: string
}) {
  const { side } = props
  const range = panelWidths[side]
  // The palette is left of its edge, so dragging right widens it; the properties panel is the other way.
  const direction = side === 'palette' ? 1 : -1
  const drag = useRef<{ x: number; width: number; last: number } | null>(null)

  const set = (width: number, commit: boolean) => {
    const next = panelWidth(side, width)
    props.onResize(next)
    if (commit) props.onCommit(next)
    return next
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = { x: event.clientX, width: props.width, last: props.width }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start) return
    start.last = set(start.width + direction * (event.clientX - start.x), false)
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    set(start.width + direction * (event.clientX - start.x), true)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP
    const keys: Record<string, number> = {
      ArrowRight: props.width + direction * step,
      ArrowLeft: props.width - direction * step,
      Home: range.min,
      End: range.max,
    }
    if (!(event.key in keys)) return
    event.preventDefault()
    set(keys[event.key]!, true)
  }

  const label =
    side === 'palette' ? 'Resize the palette' : 'Resize the properties panel'
  return (
    <div
      role='separator'
      aria-label={label}
      aria-orientation='vertical'
      aria-valuenow={props.width}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      tabIndex={0}
      title={`${label} (double click to reset)`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null
      }}
      onKeyDown={onKeyDown}
      onDoubleClick={() => set(range.default, true)}
      className={cn(
        // A wide, invisible grip over the panel border; the line shows on hover and focus.
        'group relative z-10 w-2 shrink-0 cursor-col-resize touch-none select-none focus-visible:outline-none',
        props.className
      )}
    >
      <span
        aria-hidden
        className='absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-[120ms] group-hover:bg-input group-focus-visible:w-0.5 group-focus-visible:bg-ring group-active:bg-ring motion-reduce:transition-none'
      />
    </div>
  )
}
