import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { MessageSquareText } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { listDocumentRAGConversations } from '@/lib/domain-api'
import { Button } from '@/components/ui/button'
import { announceAnswer } from './chat-notify'
import { ChatColumnResizer } from './chat-column-resizer'
import {
  clampChatColumnWidth,
  readColumnWidth,
  writeColumnWidth,
} from './chat-column-width'
import { ChatPanelContext, useDocumentChatPanel } from './chat-panel-context'
import { readChatPreferences } from './chat-preferences'
import { onFixRequest } from './editor-source'
import type { Attachment } from './question-extras'
import { addSelection } from './selection-context'

// The chat itself (Markdown, previews, history) loads when the panel opens, so a
// document page only carries the button.
const PanelBody = lazy(() => import('./document-chat-panel-body'))

const OPEN_KEY = 'dokudocs.askAIPanelOpen'

function readOpen(userID: string): boolean {
  try {
    return localStorage.getItem(`${OPEN_KEY}:${userID}`) === '1'
  } catch {
    return false
  }
}

function writeOpen(userID: string, open: boolean) {
  try {
    localStorage.setItem(`${OPEN_KEY}:${userID}`, open ? '1' : '0')
  } catch {
    // Private windows and blocked storage: the panel just starts shut next time.
  }
}

/**
 * Holds one document's chat for the page: whether the column is open (kept per
 * User across documents), the chat list and the unread count. The button and the
 * column read it, so they can sit in different parts of the page.
 */
export function DocumentChatProvider({
  documentID,
  workspaceID,
  title,
  children,
}: {
  documentID: string
  workspaceID: string
  title: string
  children: ReactNode
}) {
  const userID = useAuthStore((state) => state.auth.user?.id ?? '')
  const [open, setOpenState] = useState(() => readOpen(userID))
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next)
      writeOpen(userID, next)
    },
    [userID]
  )
  const [columnWidth, setColumnWidthState] = useState(() =>
    readColumnWidth(userID)
  )
  // The edge is dragged many times a second; the width is kept only once it settles.
  const setColumnWidth = useCallback(
    (width: number, commit: boolean) => {
      const next = clampChatColumnWidth(width)
      setColumnWidthState(next)
      if (commit) writeColumnWidth(userID, next)
    },
    [userID]
  )
  // The chat whose answer was still being written when the panel was shut.
  const [awaiting, setAwaiting] = useState<string>()
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
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [focusRequest, setFocusRequest] = useState(0)
  const [prefill, setPrefill] = useState({ text: '', id: 0 })
  const openChat = () => {
    setOpen(true)
    setFocusRequest((n) => n + 1)
  }
  useEffect(
    () =>
      onFixRequest(documentID, (text) => {
        setPrefill((was) => ({ text, id: was.id + 1 }))
        setOpen(true)
        setFocusRequest((n) => n + 1)
      }),
    [documentID, setOpen]
  )
  const addToChat = (selection: Attachment) => {
    const result = addSelection(attachments, selection)
    setAttachments(result.attachments)
    openChat()
    return result.error
  }
  return (
    <ChatPanelContext.Provider
      value={{
        documentID,
        workspaceID,
        title,
        open,
        setOpen,
        columnWidth,
        setColumnWidth,
        unread,
        conversations,
        listKey,
        onRunning: setAwaiting,
        draft: { attachments, onChange: setAttachments, focusRequest, prefill },
        addToChat,
        openChat,
      }}
    >
      {children}
    </ChatPanelContext.Provider>
  )
}

/** The toggle for the chat column, placed in the editor header. */
export function AskAIButton() {
  const chat = useDocumentChatPanel()
  if (!chat) return null
  const { open, setOpen, unread } = chat
  return (
    <Button
      variant={open ? 'secondary' : 'outline'}
      size='sm'
      className='h-8 gap-1.5 text-xs'
      aria-label={unread > 0 ? `Ask AI, ${unread} unread` : 'Ask AI'}
      aria-expanded={open}
      aria-controls='ask-ai-panel'
      onClick={() => setOpen(!open)}
    >
      <MessageSquareText className='size-3.5' />
      <span className='hidden md:inline'>Ask AI</span>
      {unread > 0 ? (
        <span
          className='size-1.5 rounded-[1px] bg-foreground'
          aria-hidden='true'
        />
      ) : null}
    </Button>
  )
}

/**
 * The chat as the right column of a document, the same for every document type.
 * It sits beside the page at the width its left edge was dragged to; below `sm`
 * it covers the page instead.
 */
export function DocumentChatColumn() {
  const chat = useDocumentChatPanel()
  if (!chat?.open) return null
  return (
    <aside
      id='ask-ai-panel'
      aria-label={`AI chat about ${chat.title}`}
      style={
        { '--chat-column-width': `${chat.columnWidth}px` } as CSSProperties
      }
      className='fixed inset-0 z-50 flex min-h-0 flex-col overflow-hidden bg-background sm:relative sm:z-auto sm:w-[var(--chat-column-width)] sm:shrink-0 sm:border-l sm:border-border'
    >
      <ChatColumnResizer
        width={chat.columnWidth}
        onResize={(width) => chat.setColumnWidth(width, false)}
        onCommit={(width) => chat.setColumnWidth(width, true)}
        className='hidden sm:block'
      />
      <Suspense
        fallback={
          <p role='status' className='p-4 text-sm text-muted-foreground'>
            Loading chat…
          </p>
        }
      >
        <PanelBody
          documentID={chat.documentID}
          workspaceID={chat.workspaceID}
          conversations={chat.conversations}
          listKey={chat.listKey}
          onRunning={chat.onRunning}
          draft={chat.draft}
          onClose={() => chat.setOpen(false)}
        />
      </Suspense>
    </aside>
  )
}

/** The button and the column together, for a page that needs no layout of its own. */
export function DocumentChatPanel(props: {
  documentID: string
  workspaceID: string
  title: string
}) {
  return (
    <DocumentChatProvider {...props}>
      <AskAIButton />
      <DocumentChatColumn />
    </DocumentChatProvider>
  )
}

/** How often a shut panel looks for the answer it is waiting on. */
const CLOSED_PANEL_POLL_MS = 5000
