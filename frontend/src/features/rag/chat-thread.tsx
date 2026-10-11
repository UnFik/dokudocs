import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Link2, Send, Square, X } from 'lucide-react'
import {
  decideAgentAction,
  listSkills,
  type AgentAction,
  type RAGCitation,
  type RAGMessage,
} from '@/lib/domain-api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { ChatRunView } from './use-chat-run'

/** An action the Agent asked for: it runs only when the User approves it here. */
export function AgentActionCard({
  action,
  conversationID,
  queryKey,
}: {
  action: AgentAction
  conversationID: string
  queryKey: readonly unknown[]
}) {
  const queryClient = useQueryClient()
  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      decideAgentAction(conversationID, action.id, approve),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    retry: false,
  })
  const status = decide.data?.status ?? action.status
  const result = decide.data?.result ?? action.result
  return (
    <div
      className='space-y-2 border-y py-3 text-sm'
      aria-label={`Action: ${action.summary}`}
    >
      <p>
        <span className='text-muted-foreground'>The assistant asks to: </span>
        <span className='font-medium'>{action.summary}</span>
      </p>
      {status === 'pending' ? (
        <div className='flex flex-wrap gap-2'>
          <Button
            size='sm'
            onClick={() => decide.mutate(true)}
            disabled={decide.isPending}
          >
            <Check />
            Approve
          </Button>
          <Button
            size='sm'
            variant='outline'
            onClick={() => decide.mutate(false)}
            disabled={decide.isPending}
          >
            <X />
            Decline
          </Button>
        </div>
      ) : (
        <p role='status' className='flex items-center gap-2 text-xs'>
          <span
            aria-hidden
            className={`size-1.5 rounded-[1px] ${status === 'approved' ? 'bg-ok' : status === 'failed' ? 'bg-destructive' : 'bg-muted-foreground'}`}
          />
          {status === 'approved'
            ? 'Approved and done.'
            : status === 'failed'
              ? `Approved, but it failed: ${result}`
              : 'Declined. Nothing was changed.'}
        </p>
      )}
      {decide.error ? (
        <p role='alert' className='text-xs text-destructive'>
          {decide.error.message}
        </p>
      ) : null}
    </div>
  )
}

export function ChatMessages({
  messages,
  actions = [],
  workspaceID,
  conversationID,
  queryKey,
}: {
  messages: RAGMessage[]
  actions?: AgentAction[]
  workspaceID: string
  conversationID: string
  queryKey: readonly unknown[]
}) {
  const placed = new Set<string>()
  return (
    <>
      {messages.map((message) => {
        const own = (message.meta?.actions ?? [])
          .map((id) => actions.find((action) => action.id === id))
          .filter((action): action is AgentAction => Boolean(action))
        own.forEach((action) => placed.add(action.id))
        return (
          <div key={message.id} className='space-y-3'>
            <ChatMessage message={message} workspaceID={workspaceID} />
            {own.map((action) => (
              <AgentActionCard
                key={action.id}
                action={action}
                conversationID={conversationID}
                queryKey={queryKey}
              />
            ))}
          </div>
        )
      })}
      {actions
        .filter((action) => !placed.has(action.id))
        .map((action) => (
          <AgentActionCard
            key={action.id}
            action={action}
            conversationID={conversationID}
            queryKey={queryKey}
          />
        ))}
    </>
  )
}

const stepLabels: Record<string, string> = {
  searching: 'Searching the documents…',
  answering: 'Writing the answer…',
  thinking: 'Working on it…',
}

const toolStates = {
  running: 'running',
  done: 'done',
  failed: 'failed',
  waiting: 'waiting for your approval',
} as const

const endings = {
  failed: 'The answer could not be finished.',
  cancelled: 'Stopped. This draft was not saved to the chat.',
  interrupted:
    'The server stopped while writing. Ask again to retry. Anything the assistant already did stays done.',
} as const

/**
 * The answer while it is being written. The text is a draft: it joins the chat
 * only when the server finishes, and a stopped or failed one says so.
 */
export function RunProgress({ view }: { view: ChatRunView }) {
  if (view.phase === 'idle') return null
  const ending = view.outcome ? endings[view.outcome] : null
  return (
    <div className='space-y-3'>
      {view.question ? (
        <article className='ml-auto max-w-3xl rounded-lg bg-primary/10 px-4 py-3'>
          <h3 className='sr-only'>You</h3>
          <p className='text-sm whitespace-pre-wrap'>{view.question}</p>
        </article>
      ) : null}
      <article
        className='max-w-4xl space-y-3'
        aria-busy={view.phase !== 'ended'}
        aria-label='Answer in progress'
      >
        <h3 className='font-mono text-[11px] text-muted-foreground'>
          dokudocs ai · draft
        </h3>
        {view.draft ? (
          <p
            className={`text-sm leading-6 whitespace-pre-wrap ${view.phase === 'ended' ? 'text-muted-foreground' : ''}`}
          >
            {view.draft}
          </p>
        ) : null}
        {view.tools.length > 0 ? (
          <ul className='flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground'>
            {view.tools.map((tool) => (
              <li key={tool.name} className='flex items-center gap-1.5'>
                <Badge variant='tag'>{tool.name}</Badge>
                {toolStates[tool.state]}
              </li>
            ))}
          </ul>
        ) : null}
        {view.phase === 'ended' ? (
          <p role='alert' className='text-sm text-destructive'>
            {ending}
            {view.outcome === 'failed' && view.message
              ? ` ${view.message}.`
              : null}
          </p>
        ) : (
          <p role='status' className='text-xs text-muted-foreground'>
            {view.phase === 'starting'
              ? 'Sending your question…'
              : (stepLabels[view.step] ?? 'Working on it…')}
          </p>
        )}
      </article>
    </div>
  )
}

export function ChatMessage({
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

  const tools = [...new Set(message.meta?.tools ?? [])]
  return (
    <article className='max-w-4xl space-y-3'>
      <h3 className='font-mono text-[11px] text-muted-foreground'>
        dokudocs ai{message.meta?.skill ? ` · /${message.meta.skill}` : ''}
      </h3>
      {/* Plain text only: an answer never loads images or links from outside. */}
      <p className='text-sm leading-6 whitespace-pre-wrap'>{message.content}</p>
      {tools.length > 0 ? (
        <p className='flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground'>
          Tools used:
          {tools.map((tool) => (
            <Badge key={tool} variant='tag'>
              {tool}
            </Badge>
          ))}
        </p>
      ) : null}
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

/** The question box, with Skills offered when the text starts with /. */
export function AskForm({
  id,
  pending,
  error,
  placeholder,
  onAsk,
  onStop,
  language,
  onLanguage,
}: {
  id: string
  pending: boolean
  error?: Error | null
  placeholder: string
  onAsk: (question: string) => void
  /** Stops the answer being written; while it runs the form offers Stop in place of Send. */
  onStop?: () => void
  language: 'id' | 'en'
  onLanguage: (language: 'id' | 'en') => void
}) {
  const [question, setQuestion] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const skills = useQuery({
    queryKey: ['skills'],
    queryFn: ({ signal }) => listSkills(signal),
    retry: false,
    staleTime: 60_000,
  })
  const typed = question.startsWith('/') ? question.slice(1).split(/\s/)[0] : ''
  const matches = question.startsWith('/')
    ? (skills.data ?? []).filter(
        (skill) => skill.name.startsWith(typed) && !question.includes(' ')
      )
    : []
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = question.trim()
    if (!text || pending) return
    onAsk(text)
    setQuestion('')
  }
  return (
    <form onSubmit={submit} className='border-t p-3'>
      <label htmlFor={id} className='mb-2 block text-sm font-medium'>
        Ask a question
      </label>
      <Textarea
        ref={box}
        id={id}
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder={placeholder}
        maxLength={10000}
        disabled={pending}
        className='min-h-20 resize-y'
      />
      {matches.length > 0 ? (
        <ul aria-label='Skills' className='mt-2 divide-y border-y text-sm'>
          {matches.map((skill) => (
            <li key={skill.id}>
              <button
                type='button'
                className='w-full px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                onClick={() => {
                  const next = `/${skill.name} `
                  setQuestion(next)
                  // Keep typing after the skill name.
                  requestAnimationFrame(() => {
                    box.current?.focus()
                    box.current?.setSelectionRange(next.length, next.length)
                  })
                }}
              >
                <span className='font-mono text-xs'>/{skill.name}</span>
                {skill.description ? (
                  <span className='ml-2 text-xs text-muted-foreground'>
                    {skill.description}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className='mt-2 flex flex-wrap items-center justify-between gap-2'>
        <label className='flex items-center gap-2 text-xs text-muted-foreground'>
          Answer language
          <select
            aria-label='Answer language'
            value={language}
            onChange={(event) => onLanguage(event.target.value as 'id' | 'en')}
            className='h-8 rounded-md border bg-background px-2 text-foreground'
          >
            <option value='en'>English</option>
            <option value='id'>Bahasa Indonesia</option>
          </select>
        </label>
        {pending && onStop ? (
          <Button type='button' size='sm' variant='outline' onClick={onStop}>
            <Square />
            Stop
          </Button>
        ) : (
          <Button
            type='submit'
            size='sm'
            disabled={pending || !question.trim()}
          >
            <Send />
            {pending ? 'Working…' : 'Send'}
          </Button>
        )}
      </div>
      {error ? (
        <p role='alert' className='mt-2 text-sm text-destructive'>
          {error.message}
        </p>
      ) : null}
    </form>
  )
}
