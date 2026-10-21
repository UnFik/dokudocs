import { useEffect, useState } from 'react'
import {
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { ApiError } from '@/lib/api-client'
import {
  createDocumentRAGConversation,
  markRAGConversationRead,
  updateRAGConversation,
  type RAGConversation,
} from '@/lib/domain-api'
import { Button } from '@/components/ui/button'
import { announceAnswer } from './chat-notify'
import type { ChatPanelState } from './chat-panel-context'
import { ChatPanelHeader } from './chat-panel-header'
import { ChatScroller } from './chat-scroller'
import { AskForm, ChatMessages, RunProgress } from './chat-thread'
import { ConversationHistory } from './conversation-history'
import { downloadConversation } from './download-conversation'
import { CurrentDocument } from './markdown/document-references'
import { useChatRun } from './use-chat-run'
import { useConversationHistory } from './use-conversation-history'
import { usePanelOptions } from './use-panel-options'

export default function PanelBody({
  documentID,
  workspaceID,
  conversations,
  listKey,
  onRunning,
  draft,
  onClose,
}: {
  documentID: string
  workspaceID: string
  conversations: UseQueryResult<RAGConversation[]>
  listKey: unknown[]
  /** Reports the chat being answered, or nothing once the answer is in. */
  onRunning: (conversationID: string | undefined) => void
  /** Text added from the page for the next question. */
  draft: ChatPanelState['draft']
  onClose: () => void
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
    <CurrentDocument documentID={documentID}>
      <div className='flex min-h-0 flex-1 flex-col'>
        <ChatPanelHeader
          title={selected?.title ?? ''}
          historyOpen={view === 'history'}
          onToggleHistory={() =>
            setView(view === 'history' ? 'chat' : 'history')
          }
          onNew={() => create.mutate()}
          newDisabled={create.isPending}
          canDownload={Boolean(history && history.messages.length > 0)}
          onDownload={() => {
            if (history)
              downloadConversation(selected?.title ?? '', history.messages)
          }}
          {...options}
          close={
            <Button
              variant='ghost'
              size='icon'
              aria-label='Close'
              className='max-sm:size-11'
              onClick={onClose}
            >
              <X />
            </Button>
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
            onRename={(id, next) =>
              change.mutate({ id, patch: { title: next } })
            }
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
                  No chats about this document yet. Start one to ask what it
                  says or to have the assistant suggest changes.
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
                  <RunProgress view={run.view} workspaceID={workspaceID} />
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
                draft={draft}
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
    </CurrentDocument>
  )
}
