import { useEffect, useMemo, useRef, useState } from 'react'
import '../lib/prosemirror/blocks/blocks.css'
import { drawDiagrams, renderMarkdown } from '../lib/render-markdown'
import './markdown-body.css'

/** The page as full-screen slides: arrows or space to move, Escape to leave. */
export function PresentationMode({
  slides,
  onClose,
}: {
  slides: string[]
  onClose: () => void
}) {
  const [index, setIndex] = useState(0)
  const last = slides.length - 1
  const html = useMemo(
    () => renderMarkdown(slides[Math.min(index, last)] ?? ''),
    [slides, index, last]
  )
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (bodyRef.current) void drawDiagrams(bodyRef.current)
  }, [html])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key))
        setIndex((current) => Math.min(last, current + 1))
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key))
        setIndex((current) => Math.max(0, current - 1))
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [last, onClose])
  return (
    <div
      role='dialog'
      aria-modal='true'
      aria-label='Presentation'
      className='fixed inset-0 z-50 flex flex-col bg-background text-foreground'
    >
      <div
        ref={bodyRef}
        className='markdown-body mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center overflow-auto px-8 py-10 text-2xl'
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div className='flex items-center justify-between px-6 py-3 text-sm text-muted-foreground'>
        <span>
          {Math.min(index, last) + 1} / {slides.length}
        </span>
        <button
          type='button'
          className='rounded px-2 py-1 hover:bg-secondary'
          onClick={onClose}
        >
          Exit
        </button>
      </div>
    </div>
  )
}
