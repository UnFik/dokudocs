import { useMemo } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import './markdown-body.css'

/** The page as read-only HTML, for the split view next to the editor. */
export function MarkdownPreview({ markdown }: { markdown: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(markdown, { gfm: true, breaks: true }) as string),
    [markdown]
  )
  return (
    <aside
      aria-label='Preview'
      className='markdown-body min-h-0 min-w-0 flex-1 overflow-auto border-t bg-card p-6 md:border-t-0 md:border-l'
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
