import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '@/lib/utils'
import { CHAT_COLUMN_WIDTH, clampChatColumnWidth } from './chat-column-width'

const STEP = 16
const BIG_STEP = 64

/**
 * The left edge of the chat column. Dragging it left widens the column; the arrow
 * keys do the same when it has focus, Home and End go to the limits, and a double
 * click puts the default width back. `onResize` follows every move, `onCommit`
 * gets the width once it settles.
 */
export function ChatColumnResizer(props: {
  width: number
  onResize: (width: number) => void
  onCommit: (width: number) => void
  className?: string
}) {
  const drag = useRef<{ x: number; width: number } | null>(null)

  const set = (width: number, commit: boolean) => {
    const next = clampChatColumnWidth(width)
    props.onResize(next)
    if (commit) props.onCommit(next)
    return next
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = { x: event.clientX, width: props.width }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start) return
    set(start.width + (start.x - event.clientX), false)
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    set(start.width + (start.x - event.clientX), true)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP
    const keys: Record<string, number> = {
      ArrowLeft: props.width + step,
      ArrowRight: props.width - step,
      Home: CHAT_COLUMN_WIDTH.min,
      End: CHAT_COLUMN_WIDTH.max,
    }
    if (!(event.key in keys)) return
    event.preventDefault()
    set(keys[event.key]!, true)
  }

  return (
    <div
      role='separator'
      aria-label='Resize the AI chat'
      aria-orientation='vertical'
      aria-valuenow={props.width}
      aria-valuemin={CHAT_COLUMN_WIDTH.min}
      aria-valuemax={CHAT_COLUMN_WIDTH.max}
      tabIndex={0}
      title='Resize the AI chat (double click to reset)'
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null
      }}
      onKeyDown={onKeyDown}
      onDoubleClick={() => set(CHAT_COLUMN_WIDTH.default, true)}
      className={cn(
        // A wide, invisible grip over the column's border; the line shows on hover and focus.
        'group absolute inset-y-0 left-0 z-10 w-2 -translate-x-1/2 cursor-col-resize touch-none select-none focus-visible:outline-none',
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
