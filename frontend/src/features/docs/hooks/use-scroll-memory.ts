import { useEffect, useRef, type RefObject } from 'react'
import {
  recallScroll,
  rememberScroll,
  type ScrollSpot,
} from '../lib/doc-scroll-memory'

function currentSpot(container: HTMLElement): ScrollSpot {
  const top = container.getBoundingClientRect().top
  const block = Array.from(
    container.querySelectorAll<HTMLElement>('[data-node-id]')
  ).find((item) => item.getBoundingClientRect().bottom > top)
  if (!block) return { top: container.scrollTop }
  return {
    top: container.scrollTop,
    nodeId: block.dataset.nodeId,
    offset: top - block.getBoundingClientRect().top,
  }
}

/**
 * Remembers where the page was scrolled to, and puts it back once the page is
 * ready. `restore` is false when the link already points at a place in the page.
 */
export function useScrollMemory(
  ref: RefObject<HTMLElement | null>,
  options: { docId: string; userId: string; ready: boolean; restore: boolean }
) {
  const { docId, userId, ready, restore } = options
  const restored = useRef(false)
  useEffect(() => {
    restored.current = false
  }, [docId, userId])
  useEffect(() => {
    const container = ref.current
    if (!container || !ready || restored.current) return
    restored.current = true
    const spot = recallScroll(userId, docId)
    if (!spot || !restore) return
    const block = spot.nodeId
      ? container.querySelector<HTMLElement>(`[data-node-id="${spot.nodeId}"]`)
      : null
    if (block)
      container.scrollTop +=
        block.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        (spot.offset ?? 0)
    else container.scrollTop = spot.top
  }, [ref, docId, userId, ready, restore])
  useEffect(() => {
    const container = ref.current
    if (!container || !ready || !userId) return
    let frame = 0
    const save = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() =>
        rememberScroll(userId, docId, currentSpot(container))
      )
    }
    container.addEventListener('scroll', save, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      container.removeEventListener('scroll', save)
    }
  }, [ref, docId, userId, ready])
}
