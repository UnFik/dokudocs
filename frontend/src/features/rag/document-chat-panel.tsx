import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquarePlus, MessageSquareText } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import {
  createDocumentRAGConversation,
  listDocumentRAGConversations,
} from '@/lib/domain-api'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ChatScroller } from './chat-scroller'
import { AskForm, ChatMessages, RunProgress } from './chat-thread'
import { useChatRun } from './use-chat-run'
import { useConversationHistory } from './use-conversation-history'

/**
 * A Conversation about one document, for every document type. Each User keeps
 * their own chats; a chat here draws on this document alone.
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
  return (
    <>
      <Button
        variant='outline'
        size='sm'
        className='fixed right-4 bottom-20 z-40 bg-background'
        onClick={() => setOpen(true)}
      >
        <MessageSquareText />
        Ask AI
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className='flex w-full flex-col gap-0 p-0 sm:max-w-lg'>
          <SheetHeader className='border-b'>
            <SheetTitle>Ask about this document</SheetTitle>
            <SheetDescription className='truncate'>{title}</SheetDescription>
          </SheetHeader>
          {open ? (
            <PanelBody documentID={documentID} workspaceID={workspaceID} />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  )
}

function PanelBody({
  documentID,
  workspaceID,
}: {
  documentID: string
  workspaceID: string
}) {
  const queryClient = useQueryClient()
  const userID = useAuthStore((state) => state.auth.user?.id ?? '')
  const [selectedID, setSelectedID] = useState<string>()
  const [language, setLanguage] = useState<'id' | 'en'>('en')
  const listKey = ['rag-document-conversations', userID, documentID]
  const conversations = useQuery({
    queryKey: listKey,
    queryFn: ({ signal }) => listDocumentRAGConversations(documentID, signal),
    retry: false,
  })
  const selected =
    conversations.data?.find((item) => item.id === selectedID) ??
    conversations.data?.[0]
  const {
    queryKey: historyKey,
    history,
    error: historyError,
    hasOlder,
    loadingOlder,
    loadOlder,
  } = useConversationHistory(userID, selected?.id)
  const create = useMutation({
    mutationFn: () => createDocumentRAGConversation(workspaceID, documentID),
    onSuccess: async (conversation) => {
      setSelectedID(conversation.id)
      await queryClient.invalidateQueries({ queryKey: listKey })
    },
  })
  const run = useChatRun({
    conversationID: selected?.id,
    workspaceID,
    language,
    onAnswered: () => queryClient.invalidateQueries({ queryKey: historyKey }),
  })

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex items-center gap-2 border-b px-4 py-2'>
        {conversations.data && conversations.data.length > 1 ? (
          <select
            aria-label='Chat'
            className='h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm'
            value={selected?.id}
            onChange={(event) => setSelectedID(event.target.value)}
          >
            {conversations.data.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title || new Date(item.createdAt).toLocaleString()}
              </option>
            ))}
          </select>
        ) : (
          <span className='flex-1 text-sm text-muted-foreground'>
            {selected?.title || (selected ? 'New chat' : '')}
          </span>
        )}
        <Button
          size='sm'
          variant='outline'
          onClick={() => create.mutate()}
          disabled={create.isPending}
        >
          <MessageSquarePlus />
          New chat
        </Button>
      </div>
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
            No chats about this document yet. Start one to ask what it says or
            to have the assistant suggest changes.
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
          workspaceID={workspaceID}
          pending={run.busy}
          error={run.error}
          placeholder='Ask about this document…'
          onAsk={(question) => void run.ask(question)}
          onStop={() => void run.stop()}
          language={language}
          onLanguage={setLanguage}
        />
      ) : null}
    </div>
  )
}
