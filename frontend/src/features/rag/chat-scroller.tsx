import {
  useCallback,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type UIEvent,
} from 'react'
import { Button } from '@/components/ui/button'

const nearBottom = 80
const nearTop = 120

/**
 * The scrolling transcript of a chat. It opens at the newest message and stays
 * there while the answer grows, unless the User has scrolled up to read. Reaching
 * the top loads earlier messages, and the message being read keeps its place.
 */
export function ChatScroller({
  children,
  resetKey,
  firstKey,
  changeKey,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  className = '',
}: {
  children: ReactNode
  /** Changes when another conversation opens: scroll to the newest message again. */
  resetKey: string
  /** Identifies the oldest message shown; it changes when earlier ones are added above it. */
  firstKey: string
  /** Changes when something is added at the bottom: a message, or more of the answer. */
  changeKey: string
  hasOlder: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const before = useRef({ resetKey, firstKey, height: 0, top: 0 })

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const last = before.current
    if (last.resetKey !== resetKey) {
      el.scrollTop = el.scrollHeight
      atBottom.current = true
    } else if (
      last.firstKey !== firstKey &&
      last.height > 0 &&
      !atBottom.current
    ) {
      // Earlier messages were added above: keep what was on screen where it was.
      el.scrollTop = last.top + (el.scrollHeight - last.height)
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight
    }
    before.current = {
      resetKey,
      firstKey,
      height: el.scrollHeight,
      top: el.scrollTop,
    }
  }, [resetKey, firstKey, changeKey])

  const onScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const el = event.currentTarget
      atBottom.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < nearBottom
      before.current.height = el.scrollHeight
      before.current.top = el.scrollTop
      if (el.scrollTop < nearTop && hasOlder && !loadingOlder) onLoadOlder()
    },
    [hasOlder, loadingOlder, onLoadOlder]
  )

  return (
    <div
      ref={box}
      role='log'
      aria-live='off'
      aria-label='Messages'
      tabIndex={0}
      onScroll={onScroll}
      // `relative` makes this the containing block of the screen-reader-only (absolute) labels in it, so they scroll and clip with it.
      className={`relative min-h-0 flex-1 space-y-5 overflow-y-auto p-4 ${className}`}
    >
      {hasOlder ? (
        <div className='flex justify-center'>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            disabled={loadingOlder}
            onClick={onLoadOlder}
          >
            {loadingOlder
              ? 'Loading earlier messages…'
              : 'Load earlier messages'}
          </Button>
        </div>
      ) : null}
      {children}
    </div>
  )
}
