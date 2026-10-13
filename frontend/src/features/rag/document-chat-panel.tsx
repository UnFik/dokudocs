import { lazy, Suspense, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MessageSquareText } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { listDocumentRAGConversations } from '@/lib/domain-api'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { announceAnswer } from './chat-notify'
import { readChatPreferences } from './chat-preferences'

// The chat itself (Markdown, previews, history) loads when the panel opens, so a
// document page only carries the button.
const PanelBody = lazy(() => import('./document-chat-panel-body'))

/**
 * A Conversation about one document, for every document type. Each User keeps
 * their own chats; a chat here draws on this document alone. The button is
 * placed by DocumentFloatingControls.
 */
export function DocumentChatPanel({
  documentID,
  workspaceID,
  title,
}: {
  documentID: string
  workspaceID: string
  title: string
}) {
  const [open, setOpen] = useState(false)
  // The chat whose answer was still being written when the panel was shut.
  const [awaiting, setAwaiting] = useState<string>()
  const userID = useAuthStore((state) => state.auth.user?.id ?? '')
  const listKey = ['rag-document-conversations', userID, documentID]
  const watching = Boolean(awaiting) && !open
  const conversations = useQuery({
    queryKey: listKey,
    queryFn: ({ signal }) => listDocumentRAGConversations(documentID, signal),
    // Not on every document page: with it, the editor smoke specs that select text lost
    // their selection (E2E failed 4 runs in a row, passed once this was lazy). So the list
    // is read once the panel is opened or an answer is awaited behind a shut panel.
    enabled: Boolean(userID) && (open || Boolean(awaiting)),
    retry: false,
    // Only while an answer is pending behind a shut panel, even in a hidden tab.
    refetchInterval: watching ? CLOSED_PANEL_POLL_MS : false,
    refetchIntervalInBackground: true,
  })
  const finished = watching
    ? conversations.data?.find((chat) => chat.id === awaiting)
    : undefined
  useEffect(() => {
    if (!finished?.unread) return
    announceAnswer(readChatPreferences(), finished.title, false)
    // Telling the User is the outside effect; it also ends the wait.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAwaiting(undefined)
  }, [finished?.unread, finished?.title])
  const unread =
    conversations.data?.filter((chat) => chat.unread && !chat.archivedAt)
      .length ?? 0
  return (
    <>
      <Button
        variant='outline'
        size='sm'
        className='bg-background'
        aria-label={unread > 0 ? `Ask AI, ${unread} unread` : 'Ask AI'}
        onClick={() => setOpen(true)}
      >
        <MessageSquareText />
        <span className='max-sm:sr-only'>Ask AI</span>
        {unread > 0 ? (
          <span
            className='size-1.5 rounded-[1px] bg-foreground'
            aria-hidden='true'
          />
        ) : null}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          showClose={false}
          className='flex w-full flex-col gap-0 p-0 sm:max-w-lg'
        >
          <SheetTitle className='sr-only'>AI chat about {title}</SheetTitle>
          <SheetDescription className='sr-only'>
            Ask questions about this document and manage your chats.
          </SheetDescription>
          {open ? (
            <Suspense
              fallback={
                <p role='status' className='p-4 text-sm text-muted-foreground'>
                  Loading chat…
                </p>
              }
            >
              <PanelBody
                documentID={documentID}
                workspaceID={workspaceID}
                conversations={conversations}
                listKey={listKey}
                onRunning={setAwaiting}
              />
            </Suspense>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  )
}

/** How often a shut panel looks for the answer it is waiting on. */
const CLOSED_PANEL_POLL_MS = 5000
