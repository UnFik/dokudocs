import { useEffect, useState } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { MessageSquareText, X } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { ApiError } from '@/lib/api-client'
import {
  createDocumentRAGConversation,
  listDocumentRAGConversations,
  markRAGConversationRead,
  updateRAGConversation,
  type RAGConversation,
} from '@/lib/domain-api'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { announceAnswer } from './chat-notify'
import { ChatPanelHeader } from './chat-panel-header'
import { readChatPreferences } from './chat-preferences'
import { ChatScroller } from './chat-scroller'
import { AskForm, ChatMessages, RunProgress } from './chat-thread'
import { ConversationHistory } from './conversation-history'
import { downloadConversation } from './download-conversation'
import { useChatRun } from './use-chat-run'
import { useConversationHistory } from './use-conversation-history'
import { usePanelOptions } from './use-panel-options'

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
            <PanelBody
              documentID={documentID}
              workspaceID={workspaceID}
              conversations={conversations}
              listKey={listKey}
              onRunning={setAwaiting}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  )
}

/** How often a shut panel looks for the answer it is waiting on. */
const CLOSED_PANEL_POLL_MS = 5000

function PanelBody({
  documentID,
  workspaceID,
  conversations,
  listKey,
  onRunning,
}: {
  documentID: string
  workspaceID: string
  conversations: UseQueryResult<RAGConversation[]>
  listKey: unknown[]
  /** Reports the chat being answered, or nothing once the answer is in. */
  onRunning: (conversationID: string | undefined) => void
}) {
  const queryClient = useQueryClient()
  const userID = useAuthStore((state) => state.auth.user?.id ?? '')
  const [selectedID, setSelectedID] = useState<string>()
  const [view, setView] = useState<'chat' | 'history'>('chat')
  const [language, setLanguage] = useState<'id' | 'en'>('en')
  const [problem, setProblem] = useState<string>()
  const options = usePanelOptions()
  const chats = conversations.data
  const selected =
    chats?.find((item) => item.id === selectedID) ??
    chats?.find((item) => !item.archivedAt) ??
    chats?.[0]
  const {
    queryKey: historyKey,
    history,
    error: historyError,
    hasOlder,
    loadingOlder,
    loadOlder,
  } = useConversationHistory(userID, selected?.id)
  const refreshList = () => queryClient.invalidateQueries({ queryKey: listKey })

  const create = useMutation({
    mutationFn: () => createDocumentRAGConversation(workspaceID, documentID),
    onSuccess: async (conversation) => {
      setSelectedID(conversation.id)
      setView('chat')
      await refreshList()
    },
  })
  const change = useMutation({
    mutationFn: (input: {
      id: string
      patch: { title?: string; pinned?: boolean; archived?: boolean }
    }) => updateRAGConversation(input.id, input.patch),
    onMutate: () => setProblem(undefined),
    onSuccess: refreshList,
    onError: (error) =>
      setProblem(
        error instanceof ApiError ? error.title : 'Could not change the chat.'
      ),
  })
  const markRead = useMutation({
    mutationFn: markRAGConversationRead,
    onSuccess: refreshList,
  })
  const run = useChatRun({
    conversationID: selected?.id,
    workspaceID,
    language,
    onAnswered: () => {
      void queryClient.invalidateQueries({ queryKey: historyKey })
      void queryClient.invalidateQueries({
        queryKey: ['rag-usage', workspaceID],
      })
      void refreshList()
      announceAnswer(
        options.preferences,
        selected?.title ?? '',
        view === 'chat'
      )
    },
  })

  useEffect(() => {
    onRunning(run.busy ? selected?.id : undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.busy, selected?.id])

  // A chat counts as read once its latest answer is on screen.
  const viewing = view === 'chat' && Boolean(history)
  useEffect(() => {
    if (viewing && selected?.unread && !markRead.isPending)
      markRead.mutate(selected.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewing, selected?.id, selected?.unread])

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <ChatPanelHeader
        title={selected?.title ?? ''}
        historyOpen={view === 'history'}
        onToggleHistory={() => setView(view === 'history' ? 'chat' : 'history')}
        onNew={() => create.mutate()}
        newDisabled={create.isPending}
        canDownload={Boolean(history && history.messages.length > 0)}
        onDownload={() => {
          if (history)
            downloadConversation(selected?.title ?? '', history.messages)
        }}
        {...options}
        close={
          <SheetClose asChild>
            <Button
              variant='ghost'
              size='icon'
              aria-label='Close'
              className='max-sm:size-11'
            >
              <X />
            </Button>
          </SheetClose>
        }
      />
      {view === 'history' ? (
        <ConversationHistory
          conversations={chats ?? []}
          selectedID={selected?.id}
          loading={conversations.isPending}
          failed={conversations.isError}
          problem={problem}
          onSelect={(id) => {
            setSelectedID(id)
            setView('chat')
          }}
          onRename={(id, next) => change.mutate({ id, patch: { title: next } })}
          onPin={(id, pinned) => change.mutate({ id, patch: { pinned } })}
          onArchive={(id, archived) =>
            change.mutate({ id, patch: { archived } })
          }
          assistantHref={(id) => `/assistant?conversation=${id}`}
        />
      ) : (
        <>
          <ChatScroller
            resetKey={selected?.id ?? ''}
            firstKey={history?.messages[0]?.id ?? ''}
            changeKey={`${history?.messages.at(-1)?.id ?? ''}|${run.view.phase}|${run.view.draft.length}|${history?.actions?.length ?? 0}`}
            hasOlder={hasOlder}
            loadingOlder={loadingOlder}
            onLoadOlder={loadOlder}
          >
            {conversations.isPending ? (
              <p role='status' className='text-sm text-muted-foreground'>
                Loading chats…
              </p>
            ) : conversations.isError ? (
              <p role='alert' className='text-sm text-destructive'>
                Could not load the chats about this document.
              </p>
            ) : !selected ? (
              <p className='text-sm text-muted-foreground'>
                No chats about this document yet. Start one to ask what it says
                or to have the assistant suggest changes.
              </p>
            ) : historyError ? (
              <p role='alert' className='text-sm text-destructive'>
                Could not load this chat.
              </p>
            ) : (
              <>
                {history && history.messages.length > 0 ? (
                  <ChatMessages
                    messages={history.messages}
                    actions={history.actions}
                    workspaceID={workspaceID}
                    conversationID={selected.id}
                    queryKey={historyKey}
                  />
                ) : run.view.phase === 'idle' ? (
                  <p className='text-sm text-muted-foreground'>
                    Ask about this document. Type / to use a skill.
                  </p>
                ) : null}
                <RunProgress view={run.view} />
              </>
            )}
            {create.error ? (
              <p role='alert' className='text-sm text-destructive'>
                {create.error.message}
              </p>
            ) : null}
          </ChatScroller>
          {selected ? (
            <AskForm
              id='document-question'
              scope='document'
              workspaceID={workspaceID}
              pending={run.busy}
              error={run.error}
              placeholder='Ask about this document…'
              chats={(chats ?? [])
                .filter((chat) => chat.id !== selected.id && !chat.archivedAt)
                .map((chat) => ({ id: chat.id, title: chat.title }))}
              onAsk={(question, extras) =>
                void run.ask(question, undefined, extras)
              }
              onStop={() => void run.stop()}
              language={language}
              onLanguage={setLanguage}
            />
          ) : null}
        </>
      )}
    </div>
  )
}
