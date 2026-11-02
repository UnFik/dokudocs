import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from 'react'
import { ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

const nearBottom = 80
const nearTop = 120

const isNearBottom = (el: HTMLElement) =>
  el.scrollHeight - el.scrollTop - el.clientHeight < nearBottom

/**
 * The scrolling transcript of a chat. It opens at the newest message and jumps
 * down when the User sends one, but it does not follow the answer as it grows:
 * the User reads where they like and a button takes them to the bottom. Reaching
 * the top loads earlier messages, and the message being read keeps its place.
 */
export function ChatScroller({
  children,
  resetKey,
  firstKey,
  changeKey,
  sendKey,
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
  /** The id of the newest message when the User wrote it, else empty: a new value scrolls down. */
  sendKey: string
  hasOlder: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  // True from opening a conversation until its first messages are on screen.
  const opening = useRef(true)
  const [away, setAway] = useState(false)
  const before = useRef({ resetKey, firstKey, sendKey, height: 0, top: 0 })

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const last = before.current
    if (
      last.resetKey !== resetKey ||
      (sendKey !== '' && last.sendKey !== sendKey)
    ) {
      el.scrollTop = el.scrollHeight
      atBottom.current = true
      opening.current = firstKey === ''
    } else if (
      last.firstKey !== firstKey &&
      last.height > 0 &&
      !atBottom.current
    ) {
      // Earlier messages were added above: keep what was on screen where it was.
      el.scrollTop = last.top + (el.scrollHeight - last.height)
    } else if (opening.current) {
      el.scrollTop = el.scrollHeight
      opening.current = firstKey === ''
    }
    atBottom.current = isNearBottom(el)
    setAway(!atBottom.current)
    before.current = {
      resetKey,
      firstKey,
      sendKey,
      height: el.scrollHeight,
      top: el.scrollTop,
    }
  }, [resetKey, firstKey, changeKey, sendKey])

  const onScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const el = event.currentTarget
      atBottom.current = isNearBottom(el)
      setAway(!atBottom.current)
      before.current.height = el.scrollHeight
      before.current.top = el.scrollTop
      if (el.scrollTop < nearTop && hasOlder && !loadingOlder) onLoadOlder()
    },
    [hasOlder, loadingOlder, onLoadOlder]
  )

  return (
    <div className='relative flex min-h-0 flex-1 flex-col'>
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
      {away ? (
        <Button
          type='button'
          size='icon'
          variant='outline'
          aria-label='Scroll to latest message'
          className='absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md'
          onClick={() =>
            box.current?.scrollTo({
              top: box.current.scrollHeight,
              behavior: 'smooth',
            })
          }
        >
          <ArrowDown />
        </Button>
      ) : null}
    </div>
  )
}

/** The `sendKey` for a transcript: the newest message's id while it is the User's own. */
export function sentKey(messages: { id: string; role: string }[] | undefined) {
  const last = messages?.at(-1)
  return last?.role === 'user' ? last.id : ''
}
