import { useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPublicDocument } from '@/lib/domain-api'
import { rememberOpenedPublicLink } from '@/lib/public-link-session'
import '../lib/prosemirror/blocks/blocks.css'
import { drawDiagrams, renderMarkdown } from '../lib/render-markdown'
import './markdown-body.css'

export function PublicMarkdownDocument({ shareToken }: { shareToken: string }) {
  const documentQuery = useQuery({
    queryKey: ['public-document', shareToken],
    queryFn: async ({ signal }) => {
      const document = await getPublicDocument(shareToken, signal)
      rememberOpenedPublicLink(shareToken)
      return document
    },
    retry: false,
  })
  const markdown = documentQuery.data?.content ?? ''
  const html = useMemo(() => renderMarkdown(markdown), [markdown])
  const articleRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (articleRef.current) void drawDiagrams(articleRef.current)
  }, [html])

  if (documentQuery.isPending)
    return (
      <p role='status' className='p-6'>
        Loading shared document…
      </p>
    )
  if (documentQuery.error || !documentQuery.data)
    return (
      <p role='alert' className='p-6'>
        This shared document is unavailable.
      </p>
    )

  const document = documentQuery.data
  return (
    <main className='min-h-screen bg-background text-foreground'>
      <header className='border-b px-6 py-5 sm:px-10'>
        <p className='text-xs text-muted-foreground'>Shared document</p>
        <h1 className='mt-1 text-2xl font-semibold'>{document.title}</h1>
        <p className='mt-1 text-sm text-muted-foreground'>
          Shared by {document.author.name}
        </p>
      </header>
      <article
        ref={articleRef}
        aria-label='Document contents'
        className='markdown-body mx-auto max-w-4xl px-6 py-8 sm:px-10'
      >
        {document.type === 'markdown' ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className='whitespace-pre-wrap'>{document.content}</pre>
        )}
      </article>
    </main>
  )
}
