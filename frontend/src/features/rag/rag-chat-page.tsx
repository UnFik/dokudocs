import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquarePlus } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { ApiError } from '@/lib/api-client'
import {
  createRAGConversation,
  deleteRAGConversation,
  listRAGConversations,
  markRAGConversationRead,
  updateRAGConversation,
} from '@/lib/domain-api'
import { getOpenedPublicLinkTokens } from '@/lib/public-link-session'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces'
import { announceAnswer } from './chat-notify'
import { ChatPanelHeader } from './chat-panel-header'
import { ChatScroller } from './chat-scroller'
import { AskForm, ChatMessages, RunProgress } from './chat-thread'
import { ConversationHistory } from './conversation-history'
import { downloadConversation } from './download-conversation'
import { useChatRun } from './use-chat-run'
import { useConversationHistory } from './use-conversation-history'
import { usePanelOptions } from './use-panel-options'

export function RAGChatPage() {
  const queryClient = useQueryClient()
  const userID = useAuthStore((state) => state.auth.user?.id ?? '')
  const { workspaces, activeWorkspaceId } = useWorkspaces()
  // "Open in AI chat" from a document panel arrives as ?conversation=<id>.
  const [selectedID, setSelectedID] = useState<string | undefined>(
    () =>
      new URLSearchParams(window.location.search).get('conversation') ??
      undefined
  )
  const [language, setLanguage] = useState<'id' | 'en'>('en')
  const [deleting, setDeleting] = useState<string>()
  const [problem, setProblem] = useState<string>()
  const options = usePanelOptions()
  const conversationsQuery = useQuery({
    queryKey: ['rag-conversations', userID],
    queryFn: ({ signal }) => listRAGConversations(signal),
    enabled: Boolean(userID),
    retry: false,
  })
  const conversations = conversationsQuery.data ?? []
  const listed =
    conversations.find((item) => item.id === selectedID) ??
    (selectedID ? undefined : conversations[0])
  // A chat opened by id may be a document chat, which the list does not carry.
  const historyQuery = useConversationHistory(
    userID,
    listed?.id ?? selectedID ?? conversations[0]?.id
  )
  const selectedConversation = listed ?? historyQuery.history?.conversation
  const createMutation = useMutation({
    mutationFn: createRAGConversation,
    onSuccess: async (conversation) => {
      setSelectedID(conversation.id)
      await queryClient.invalidateQueries({
        queryKey: ['rag-conversations', userID],
      })
    },
  })
  const run = useChatRun({
    conversationID: selectedConversation?.id,
    workspaceID: selectedConversation?.workspaceId ?? '',
    language,
    onAnswered: () => {
      void queryClient.invalidateQueries({
        queryKey: ['rag-conversation', userID, selectedConversation?.id],
      })
      void queryClient.invalidateQueries({
        queryKey: ['rag-conversations', userID],
      })
      void queryClient.invalidateQueries({ queryKey: ['rag-usage'] })
      announceAnswer(
        options.preferences,
        selectedConversation?.title ?? '',
        true
      )
    },
  })
  const refreshList = () =>
    queryClient.invalidateQueries({ queryKey: ['rag-conversations', userID] })
  const changeMutation = useMutation({
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
  const deleteMutation = useMutation({
    mutationFn: deleteRAGConversation,
    onSuccess: async (_result, conversationID) => {
      queryClient.setQueryData(
        ['rag-conversations', userID],
        (current: typeof conversations | undefined) =>
          current?.filter((item) => item.id !== conversationID) ?? []
      )
      queryClient.removeQueries({
        queryKey: ['rag-conversation', userID, conversationID],
      })
      if (selectedID === conversationID) setSelectedID(undefined)
    },
  })

  const history = historyQuery.history
  // A chat counts as read once its latest answer is on screen.
  useEffect(() => {
    if (history && selectedConversation?.unread && !markRead.isPending)
      markRead.mutate(selectedConversation.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(history), selectedConversation?.id, selectedConversation?.unread])
  const canAsk = Boolean(
    selectedConversation &&
    workspaces.some(
      (workspace) => workspace.id === selectedConversation.workspaceId
    )
  )

  const submitQuestion = (text: string) => {
    if (!selectedConversation || !canAsk || run.busy) return
    void run.ask(text, getOpenedPublicLinkTokens())
  }

  return (
    <>
      <Header>
        <div>
          <h1 className='text-sm font-semibold'>DokuDocs AI</h1>
          <p className='text-xs text-muted-foreground'>
            Answers from documents you can read
          </p>
        </div>
      </Header>
      <Main fixed fluid className='min-h-0 p-4 sm:p-6'>
        <div className='grid min-h-0 flex-1 gap-4 overflow-y-auto lg:grid-cols-[17rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-visible'>
          <aside className='flex min-h-0 flex-col rounded-lg border bg-card'>
            <div className='border-b p-3'>
              <h2 className='text-sm font-semibold'>Your chats</h2>
            </div>
            <ConversationHistory
              conversations={conversations}
              selectedID={selectedConversation?.id}
              loading={conversationsQuery.isPending}
              failed={Boolean(conversationsQuery.error)}
              problem={problem}
              onSelect={setSelectedID}
              onRename={(id, title) =>
                changeMutation.mutate({ id, patch: { title } })
              }
              onPin={(id, pinned) =>
                changeMutation.mutate({ id, patch: { pinned } })
              }
              onArchive={(id, archived) =>
                changeMutation.mutate({ id, patch: { archived } })
              }
              onDelete={setDeleting}
              subtitle={(chat) =>
                workspaces.find((item) => item.id === chat.workspaceId)?.name ??
                'Former workspace'
              }
            />
          </aside>

          <section className='flex h-[34rem] max-h-[80svh] min-w-0 flex-col rounded-lg border bg-card lg:h-auto lg:max-h-none'>
            {selectedConversation && historyQuery.isPending ? (
              <p role='status' className='m-4 text-sm text-muted-foreground'>
                Loading conversation…
              </p>
            ) : selectedConversation && historyQuery.error ? (
              <p role='alert' className='m-4 text-sm text-destructive'>
                Could not load this conversation.
              </p>
            ) : selectedConversation && history ? (
              <>
                <ChatPanelHeader
                  title={history.conversation.title}
                  onNew={() => createMutation.mutate(activeWorkspaceId)}
                  newDisabled={!activeWorkspaceId || createMutation.isPending}
                  canDownload={history.messages.length > 0}
                  onDownload={() =>
                    downloadConversation(
                      history.conversation.title,
                      history.messages
                    )
                  }
                  {...options}
                />
                <ChatScroller
                  resetKey={history.conversation.id}
                  firstKey={history.messages[0]?.id ?? ''}
                  changeKey={`${history.messages.at(-1)?.id ?? ''}|${run.view.phase}|${run.view.draft.length}|${history.actions?.length ?? 0}`}
                  hasOlder={historyQuery.hasOlder}
                  loadingOlder={historyQuery.loadingOlder}
                  onLoadOlder={historyQuery.loadOlder}
                >
                  {history.messages.length === 0 &&
                  run.view.phase === 'idle' ? (
                    <p className='text-sm text-muted-foreground'>
                      Ask about policies, decisions, or details in this
                      workspace’s documents. Type / to use a skill.
                    </p>
                  ) : (
                    <ChatMessages
                      messages={history.messages}
                      actions={history.actions}
                      workspaceID={history.conversation.workspaceId}
                      conversationID={history.conversation.id}
                      queryKey={[
                        'rag-conversation',
                        userID,
                        history.conversation.id,
                      ]}
                    />
                  )}
                  <RunProgress view={run.view} />
                </ChatScroller>
                {canAsk ? (
                  <AskForm
                    id='rag-question'
                    workspaceID={history.conversation.workspaceId}
                    pending={run.busy}
                    error={run.error}
                    placeholder='Ask about documents in this workspace…'
                    onAsk={submitQuestion}
                    onStop={() => void run.stop()}
                    language={language}
                    onLanguage={setLanguage}
                  />
                ) : (
                  <div
                    role='status'
                    className='border-t p-3 text-sm text-muted-foreground'
                  >
                    This chat is read-only because you no longer belong to its
                    workspace.
                  </div>
                )}
              </>
            ) : (
              <div className='m-auto max-w-md p-6 text-center'>
                <h2 className='text-lg font-semibold'>Ask your workspace</h2>
                <p className='mt-2 text-sm text-muted-foreground'>
                  Start a chat to search active Markdown documents. Replies use
                  citations and say when indexed coverage may be incomplete.
                </p>
                <Button
                  className='mt-4'
                  disabled={!activeWorkspaceId || createMutation.isPending}
                  onClick={() => createMutation.mutate(activeWorkspaceId)}
                >
                  <MessageSquarePlus />
                  New chat
                </Button>
                {createMutation.error ? (
                  <p role='alert' className='mt-3 text-sm text-destructive'>
                    {createMutation.error.message}
                  </p>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </Main>
      <AlertDialog
        open={deleting !== undefined}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              The chat and all its messages are deleted for good. They cannot be
              restored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => {
                if (deleting) deleteMutation.mutate(deleting)
                setDeleting(undefined)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
