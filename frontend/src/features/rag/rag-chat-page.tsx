import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, MessageSquarePlus, Send, Trash2 } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import {
  askRAGQuestion,
  createRAGConversation,
  deleteRAGConversation,
  getRAGConversation,
  listRAGConversations,
  type RAGCitation,
  type RAGMessage,
} from '@/lib/domain-api'
import { getOpenedPublicLinkTokens } from '@/lib/public-link-session'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces'

export function RAGChatPage() {
  const queryClient = useQueryClient()
  const userID = useAuthStore((state) => state.auth.user?.id ?? '')
  const { workspaces, activeWorkspaceId } = useWorkspaces()
  const [selectedID, setSelectedID] = useState<string>()
  const [question, setQuestion] = useState('')
  const [language, setLanguage] = useState<'id' | 'en'>('en')
  const conversationsQuery = useQuery({
    queryKey: ['rag-conversations', userID],
    queryFn: ({ signal }) => listRAGConversations(signal),
    enabled: Boolean(userID),
    retry: false,
  })
  const conversations = conversationsQuery.data ?? []
  const selectedConversation =
    conversations.find((item) => item.id === selectedID) ?? conversations[0]
  const historyQuery = useQuery({
    queryKey: ['rag-conversation', userID, selectedConversation?.id],
    queryFn: ({ signal }) =>
      getRAGConversation(selectedConversation!.id, signal),
    enabled: Boolean(userID && selectedConversation),
    retry: false,
  })
  const createMutation = useMutation({
    mutationFn: createRAGConversation,
    onSuccess: async (conversation) => {
      setSelectedID(conversation.id)
      await queryClient.invalidateQueries({
        queryKey: ['rag-conversations', userID],
      })
    },
  })
  const askMutation = useMutation({
    mutationFn: (input: {
      workspaceID: string
      conversationID: string
      question: string
      language: 'id' | 'en'
    }) =>
      askRAGQuestion(input.workspaceID, input.conversationID, {
        question: input.question,
        language: input.language,
        publicLinkTokens: getOpenedPublicLinkTokens(),
      }),
    onSuccess: async (_answer, input) => {
      setQuestion('')
      await queryClient.invalidateQueries({
        queryKey: ['rag-conversation', userID, input.conversationID],
      })
    },
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

  const history = historyQuery.data
  const canAsk = Boolean(
    selectedConversation &&
    workspaces.some(
      (workspace) => workspace.id === selectedConversation.workspaceId
    )
  )

  const submitQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = question.trim()
    if (!text || !selectedConversation || !canAsk || askMutation.isPending)
      return
    askMutation.reset()
    askMutation.mutate({
      workspaceID: selectedConversation.workspaceId,
      conversationID: selectedConversation.id,
      question: text,
      language,
    })
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
                            onClick={() =>
                              deleteMutation.mutate(conversation.id)
                            }
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
                <div className='min-h-0 flex-1 space-y-5 overflow-y-auto p-4'>
                  {history.messages.length === 0 ? (
                    <p className='text-sm text-muted-foreground'>
                      Ask about policies, decisions, or details in this
                      workspace’s Markdown documents.
                    </p>
                  ) : (
                    history.messages.map((message) => (
                      <ChatMessage
                        key={message.id}
                        message={message}
                        workspaceID={history.conversation.workspaceId}
                      />
                    ))
                  )}
                </div>
                {canAsk ? (
                  <form onSubmit={submitQuestion} className='border-t p-3'>
                    <label
                      htmlFor='rag-question'
                      className='mb-2 block text-sm font-medium'
                    >
                      Ask a question
                    </label>
                    <Textarea
                      id='rag-question'
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      placeholder='Ask about documents in this workspace…'
                      maxLength={10000}
                      disabled={askMutation.isPending}
                      className='min-h-20 resize-y'
                    />
                    <div className='mt-2 flex flex-wrap items-center justify-between gap-2'>
                      <label className='flex items-center gap-2 text-xs text-muted-foreground'>
                        Answer language
                        <select
                          aria-label='Answer language'
                          value={language}
                          onChange={(event) =>
                            setLanguage(event.target.value as 'id' | 'en')
                          }
                          className='h-8 rounded-md border bg-background px-2 text-foreground'
                        >
                          <option value='en'>English</option>
                          <option value='id'>Bahasa Indonesia</option>
                        </select>
                      </label>
                      <Button
                        type='submit'
                        size='sm'
                        disabled={
                          askMutation.isPending || !question.trim() || !canAsk
                        }
                      >
                        <Send />
                        {askMutation.isPending ? 'Searching…' : 'Send'}
                      </Button>
                    </div>
                    {askMutation.error ? (
                      <p role='alert' className='mt-2 text-sm text-destructive'>
                        {askMutation.error.message}
                      </p>
                    ) : null}
                  </form>
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
    </>
  )
}

function ChatMessage({
  message,
  workspaceID,
}: {
  message: RAGMessage
  workspaceID: string
}) {
  if (message.role === 'user')
    return (
      <article className='ml-auto max-w-3xl rounded-lg bg-primary/10 px-4 py-3'>
        <h3 className='sr-only'>You</h3>
        <p className='text-sm whitespace-pre-wrap'>{message.content}</p>
      </article>
    )

  return (
    <article className='max-w-4xl space-y-3'>
      <h3 className='text-xs font-semibold tracking-wide text-muted-foreground uppercase'>
        DokuDocs AI
      </h3>
      <p className='text-sm leading-6 whitespace-pre-wrap'>{message.content}</p>
      {message.sourcesMayBeIncomplete ? (
        <p role='status' className='text-xs text-warn'>
          Some readable documents have stale indexes. This answer may be
          incomplete.
        </p>
      ) : null}
      {message.coveragePartial ? (
        <p role='status' className='text-xs text-warn'>
          Some document blocks could not be indexed, so coverage is partial.
        </p>
      ) : null}
      {message.citations.length > 0 ? (
        <div className='border-t pt-3'>
          <h4 className='mb-2 text-xs font-semibold'>Sources</h4>
          <ol className='space-y-2'>
            {message.citations.map((citation) => (
              <Citation
                key={`${citation.documentId}:${citation.nodeId}`}
                citation={citation}
                workspaceID={workspaceID}
              />
            ))}
          </ol>
        </div>
      ) : null}
    </article>
  )
}

function Citation({
  citation,
  workspaceID,
}: {
  citation: RAGCitation
  workspaceID: string
}) {
  const href = `/docs/${encodeURIComponent(citation.documentId)}?workspaceId=${encodeURIComponent(workspaceID)}&nodeId=${encodeURIComponent(citation.nodeId)}#node-${encodeURIComponent(citation.nodeId)}`
  return (
    <li className='rounded-md border bg-background p-3 text-xs'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <span className='font-medium'>
          {citation.documentTitle || 'Workspace document'}
          {citation.projectName ? ` · ${citation.projectName}` : ''}
          {citation.breadcrumb ? ` · ${citation.breadcrumb}` : ''}
        </span>
        <a
          href={href}
          className='inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline'
        >
          <Link2 className='size-3.5' />
          Open block
        </a>
      </div>
      <blockquote className='mt-2 border-l-2 pl-3 text-muted-foreground'>
        {citation.quotedText}
      </blockquote>
      {citation.sourceChanged ? (
        <p role='status' className='mt-2 text-warn'>
          This source changed after the answer was created.
        </p>
      ) : null}
    </li>
  )
}
