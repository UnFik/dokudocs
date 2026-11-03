import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/** The Markdown the page exports, as text, beside the editor. Read-only. */
export function MarkdownSource({ markdown }: { markdown: string }) {
  const [copied, setCopied] = useState(false)
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(reset.current), [])

  const copy = () => {
    navigator.clipboard
      .writeText(markdown)
      .then(() => {
        toast.success('Document Markdown copied')
        setCopied(true)
        clearTimeout(reset.current)
        reset.current = setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => toast.error('Could not copy the Markdown'))
  }

  const label = copied ? 'Copied' : 'Copy Markdown'
  return (
    <aside
      aria-label='Markdown source'
      className='min-h-0 min-w-0 flex-1 overflow-auto border-t bg-card md:border-t-0 md:border-l'
    >
      {/* A zero-height sticky anchor keeps the button in the corner while the text scrolls. */}
      <div className='sticky top-2 z-10 h-0'>
        <Button
          type='button'
          size='icon'
          variant='outline'
          aria-label={label}
          title={label}
          onClick={copy}
          className='absolute top-0 right-2 size-11 bg-card md:size-8'
        >
          {copied ? (
            <Check className='size-4 text-ok' aria-hidden />
          ) : (
            <Copy className='size-4' aria-hidden />
          )}
        </Button>
      </div>
      <pre className='py-6 pr-14 pl-6 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-foreground'>
        {markdown}
      </pre>
    </aside>
  )
}
