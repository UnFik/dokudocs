import { useEffect, useMemo, useRef } from 'react'
import '../lib/prosemirror/blocks/blocks.css'
import { drawDiagrams, renderMarkdown } from '../lib/render-markdown'
import './markdown-body.css'

/** The page as read-only HTML, for the split view next to the editor. */
export function MarkdownPreview({ markdown }: { markdown: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown])
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (ref.current) void drawDiagrams(ref.current)
  }, [html])
  return (
    <aside
      ref={ref}
      aria-label='Preview'
      className='markdown-body min-h-0 min-w-0 flex-1 overflow-auto border-t bg-card p-6 md:border-t-0 md:border-l'
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
