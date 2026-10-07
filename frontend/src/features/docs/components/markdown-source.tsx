/** The Markdown the page exports, as text, beside the editor. Read-only. */
export function MarkdownSource({ markdown }: { markdown: string }) {
  return (
    <aside
      aria-label='Markdown source'
      className='min-h-0 min-w-0 flex-1 overflow-auto border-t bg-card md:border-t-0 md:border-l'
    >
      <pre className='p-6 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-foreground'>
        {markdown}
      </pre>
    </aside>
  )
}
