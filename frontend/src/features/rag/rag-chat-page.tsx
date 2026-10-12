import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquarePlus, Trash2 } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import {
  createRAGConversation,
  deleteRAGConversation,
  listRAGConversations,
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
import { ChatScroller } from './chat-scroller'
import { AskForm, ChatMessages, RunProgress } from './chat-thread'
import { useChatRun } from './use-chat-run'
import { useConversationHistory } from './use-conversation-history'

export function RAGChatPage() {
  const queryClient = useQueryClient()
  const userID = useAuthStore((state) => state.auth.user?.id ?? '')
  const { workspaces, activeWorkspaceId } = useWorkspaces()
  const [selectedID, setSelectedID] = useState<string>()
  const [language, setLanguage] = useState<'id' | 'en'>('en')
  const [deleting, setDeleting] = useState<string>()
  const conversationsQuery = useQuery({
    queryKey: ['rag-conversations', userID],
    queryFn: ({ signal }) => listRAGConversations(signal),
    enabled: Boolean(userID),
    retry: false,
  })
  const conversations = conversationsQuery.data ?? []
  const selectedConversation =
    conversations.find((item) => item.id === selectedID) ?? conversations[0]
  const historyQuery = useConversationHistory(userID, selectedConversation?.id)
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
    onAnswered: () =>
      queryClient.invalidateQueries({
        queryKey: ['rag-conversation', userID, selectedConversation?.id],
      }),
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
      <Main fluid className='flex min-h-0 flex-1 flex-col p-4 sm:p-6'>
        <div className='grid min-h-0 flex-1 gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]'>
          <aside className='flex min-h-0 flex-col rounded-lg border bg-card'>
            <div className='flex items-center justify-between border-b p-3'>
              <h2 className='text-sm font-semibold'>Your chats</h2>
              <Button
                size='sm'
                variant='outline'
                aria-label='New chat'
                title='New chat'
                disabled={!activeWorkspaceId || createMutation.isPending}
                onClick={() => createMutation.mutate(activeWorkspaceId)}
              >
                <MessageSquarePlus />
              </Button>
            </div>
            <div className='min-h-0 flex-1 overflow-y-auto p-2'>
              {conversationsQuery.isPending ? (
                <p role='status' className='p-2 text-sm text-muted-foreground'>
                  Loading chats…
                </p>
              ) : conversationsQuery.error ? (
                <p role='alert' className='p-2 text-sm text-destructive'>
                  Could not load chat history.
                </p>
              ) : conversations.length === 0 ? (
                <p className='p-2 text-sm text-muted-foreground'>
                  No saved chats yet.
                </p>
              ) : (
                <ul className='space-y-1'>
                  {conversations.map((conversation) => {
                    const workspace = workspaces.find(
                      (item) => item.id === conversation.workspaceId
                    )
                    return (
                      <li key={conversation.id}>
                        <div
                          className={`flex items-center gap-1 rounded-md ${selectedConversation?.id === conversation.id ? 'bg-accent' : ''}`}
                        >
                          <button
                            type='button'
                            className='min-w-0 flex-1 px-2 py-2 text-left text-sm hover:bg-accent/70'
                            aria-current={
                              selectedConversation?.id === conversation.id
                                ? 'page'
                                : undefined
                            }
                            onClick={() => setSelectedID(conversation.id)}
                          >
                            <span className='block truncate font-medium'>
                              {conversation.title || 'Workspace chat'}
                            </span>
                            <span className='block truncate text-xs text-muted-foreground'>
                              {workspace?.name ?? 'Former workspace'}
                            </span>
                          </button>
                          <Button
                            size='icon'
                            variant='ghost'
                            className='mr-1 size-8'
                            aria-label='Delete chat'
                            title='Delete chat'
                            disabled={deleteMutation.isPending}
                            onClick={() => setDeleting(conversation.id)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </aside>

          <section className='flex min-h-[26rem] min-w-0 flex-col rounded-lg border bg-card'>
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
                <div className='border-b px-4 py-3'>
                  <h2 className='font-semibold'>
                    {history.conversation.title || 'Workspace chat'}
                  </h2>
                  <p className='text-xs text-muted-foreground'>
                    {workspaces.find(
                      (item) => item.id === history.conversation.workspaceId
                    )?.name ?? 'Former workspace'}
                    {' · '}
                    Whole workspace
                  </p>
                </div>
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
