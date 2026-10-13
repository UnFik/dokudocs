import { useEffect, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import './answer-code.css'
import { highlight, languageOf } from './highlight'

const COPIED_FOR_MS = 2000

/** A fenced block: the language as a quiet tag, a Copy button, and code that scrolls on its own. */
export function CodeBlock({
  code,
  fence,
}: {
  code: string
  /** The name after the opening fence, such as "go". */
  fence?: string
}) {
  const language = languageOf(fence)
  const [coloured, setColoured] = useState<ReactNode>()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!language) return
    let current = true
    void highlight(code, language).then((result) => {
      if (current) setColoured(result)
    })
    return () => {
      current = false
    }
  }, [code, language])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_FOR_MS)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch {
      // Clipboard blocked: the text is still selectable in the block.
    }
  }

  return (
    <div className='answer-code my-3 overflow-hidden rounded-md border bg-card'>
      <div className='flex items-center justify-between border-b px-3 py-1'>
        <span className='font-mono text-[11px] text-muted-foreground'>
          {fence?.trim().toLowerCase() || 'text'}
        </span>
        <button
          type='button'
          onClick={() => void copy()}
          className='inline-flex items-center gap-1.5 rounded-sm px-1.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-sm:min-h-11 max-sm:px-3'
        >
          {copied ? (
            <Check className='size-3.5' aria-hidden='true' />
          ) : (
            <Copy className='size-3.5' aria-hidden='true' />
          )}
          {copied ? 'Copied' : 'Copy'}
          <span className='sr-only'> code</span>
        </button>
      </div>
      <pre className='overflow-x-auto p-3 font-mono text-xs leading-5'>
        <code>{coloured ?? code}</code>
      </pre>
      <span role='status' className='sr-only'>
        {copied ? 'Code copied' : ''}
      </span>
    </div>
  )
}
