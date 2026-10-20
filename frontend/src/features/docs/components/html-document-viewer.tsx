import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DocumentItem } from '@/types/dokudocs'
import { Download, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import {
  getHtmlPageTicket,
  listDocumentComments,
  updateDocumentMetadata,
} from '@/lib/domain-api'
import { useTheme } from '@/context/theme-provider'
import { Button } from '@/components/ui/button'
import { useChatPanelSibling } from '@/features/rag/chat-panel-context'
import { readThemeTokens } from '../lib/mermaid-theme'
import {
  createPageBridge,
  safeFileName,
  saveTextFile,
  type PageTheme,
} from '../lib/page-bridge'
import { EditorHeader } from './editor-header'
import { PageCommentsPanel } from './page-comments-panel'

/** The colours a page may use, named as the app names them. */
function pageTheme(isDark: boolean): PageTheme {
  const tokens = readThemeTokens(isDark)
  return {
    mode: isDark ? 'dark' : 'light',
    vars: {
      '--background': tokens.background,
      '--foreground': tokens.foreground,
      '--card': tokens.card,
      '--muted': tokens.muted,
      '--muted-foreground': tokens.mutedForeground,
      '--border': tokens.border,
      '--signal': tokens.signal,
      '--signal-foreground': tokens.signalForeground,
    },
  }
}

/**
 * An HTML document: a page written through MCP, shown in a sandboxed frame from
 * the separate content origin (ADR 0052). Nobody edits it here; people read it,
 * download it, rename it and comment on it as a whole.
 */
export function HtmlDocumentViewer({
  document: doc,
  workspaceID,
  userID,
}: {
  document: DocumentItem
  workspaceID: string
  userID: string
}) {
  const queryClient = useQueryClient()
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [title, setTitle] = useState(doc.title)
  const [isCommentsOpen, setIsCommentsOpen] = useState(false)
  useChatPanelSibling(isCommentsOpen, () => setIsCommentsOpen(false))

  // A new address is asked for when the page is rewritten, so the frame shows the latest.
  const ticket = useQuery({
    queryKey: ['html-page-ticket', workspaceID, doc.id, doc.updatedAt],
    queryFn: ({ signal }) => getHtmlPageTicket(workspaceID, doc.id, signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
  const capabilities = ticket.data?.capabilities
  const canEdit = ticket.data?.canEdit ?? false
  const canComment = ticket.data?.canComment ?? false

  const isDarkRef = useRef(isDark)
  const bridgeRef = useRef<ReturnType<typeof createPageBridge>>(undefined)
  useEffect(() => {
    const bridge = createPageBridge({
      frame: () => frameRef.current?.contentWindow,
      capabilities: capabilities ?? [],
      theme: () => pageTheme(isDarkRef.current),
      // A click or key press inside the frame counts for the whole window.
      activation: () => navigator.userActivation?.isActive ?? false,
      save: saveTextFile,
    })
    bridgeRef.current = bridge
    const onMessage = (event: MessageEvent) => bridge.handle(event)
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      bridgeRef.current = undefined
    }
  }, [capabilities])
  useEffect(() => {
    isDarkRef.current = isDark
    bridgeRef.current?.sendTheme()
  }, [isDark])

  const commentsQuery = useQuery({
    queryKey: ['document-comments', workspaceID, doc.id],
    queryFn: ({ signal }) => listDocumentComments(workspaceID, doc.id, signal),
    enabled: isCommentsOpen,
  })
  const threads = useMemo(() => commentsQuery.data ?? [], [commentsQuery.data])

  const titleMutation = useMutation({
    mutationFn: (next: string) =>
      updateDocumentMetadata(workspaceID, doc.id, { title: next }),
    onSuccess: (updated) => {
      setTitle(updated.title)
      void queryClient.invalidateQueries({
        queryKey: ['document', workspaceID, doc.id],
      })
    },
    onError: (error) => toast.error(error.message),
  })

  const download = () =>
    saveTextFile({
      name: safeFileName(`${title}.html`),
      mime: 'text/html',
      content: doc.content,
    })

  return (
    <div className='flex h-screen w-full flex-col overflow-hidden bg-background'>
      <EditorHeader
        docId={doc.id}
        title={title}
        type={doc.type}
        projectId={doc.projectId ?? null}
        projectName={doc.projectName}
        category={doc.category}
        categories={doc.categories}
        isSaving={titleMutation.isPending}
        isDirty={false}
        lastSaved={new Date(doc.updatedAt)}
        onTitleChange={(next) => titleMutation.mutate(next)}
        titleReadOnly={!canEdit}
        onToggleComments={() => setIsCommentsOpen((open) => !open)}
        isCommentsOpen={isCommentsOpen}
        commentsCount={threads.filter((thread) => !thread.resolvedAt).length}
      />
      <div
        role='note'
        className='flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted px-4 py-1.5 text-xs text-muted-foreground'
      >
        <ShieldCheck className='size-3.5 shrink-0' aria-hidden />
        <span className='min-w-0 flex-1'>
          Written through MCP by{' '}
          {doc.author.name || 'someone in this workspace'}. This page runs in a
          sandbox: it cannot reach your Dokudocs account or the network.
        </span>
        <Button
          size='sm'
          variant='ghost'
          className='h-6 gap-1.5 px-2 text-xs'
          onClick={download}
        >
          <Download className='size-3.5' aria-hidden />
          Download .html
        </Button>
      </div>
      <div className='flex min-h-0 flex-1'>
        <div className='min-w-0 flex-1'>
          {ticket.isPending ? (
            <p className='p-6 text-sm text-muted-foreground'>
              Opening the page…
            </p>
          ) : ticket.error || !ticket.data ? (
            <div role='alert' className='p-6 text-sm'>
              <p className='font-medium'>This page cannot be shown.</p>
              <p className='mt-1 text-muted-foreground'>
                HTML pages are not switched on for this server, or you can no
                longer read this one.
              </p>
            </div>
          ) : (
            <iframe
              ref={frameRef}
              key={ticket.data.url}
              src={ticket.data.url}
              title={title}
              // No allow-same-origin: the page has an opaque origin and cannot read this app.
              sandbox='allow-scripts'
              referrerPolicy='no-referrer'
              className='size-full border-0 bg-background'
            />
          )}
        </div>
        {isCommentsOpen && (
          <PageCommentsPanel
            workspaceID={workspaceID}
            documentID={doc.id}
            userID={userID}
            threads={threads}
            loading={commentsQuery.isPending}
            failed={Boolean(commentsQuery.error)}
            canComment={canComment}
            canDecide={canEdit}
          />
        )}
      </div>
    </div>
  )
}
