import { FileCode } from 'lucide-react'

/** Shown for an HTML document until its viewer exists (ADR 0052). */
export function HtmlDocumentPending({ title }: { title: string }) {
  return (
    <div className='flex h-full min-h-screen flex-col items-center justify-center gap-2 px-6 text-center'>
      <FileCode className='size-8 text-muted-foreground' aria-hidden />
      <h1 className='text-lg font-semibold'>{title}</h1>
      <p className='max-w-sm text-sm text-muted-foreground'>
        This page was written through MCP. It cannot be shown in Dokudocs yet.
      </p>
    </div>
  )
}
