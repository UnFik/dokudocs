import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Check, Link2, Send, Square, X } from 'lucide-react'
import {
  MAX_DOCUMENT_MENTIONS,
  activeMentionQuery,
  messageParts,
  documentLabel,
  serialize,
  trackEdit,
  type PlacedDocumentMention,
} from '@/lib/document-mentions'
import {
  decideAgentAction,
  listSkills,
  searchChatDocuments,
  type AgentAction,
  type ChatDocumentHit,
  type RAGCitation,
  type RAGMessage,
} from '@/lib/domain-api'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
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
          {status === 'approved' && !result
            ? 'Approved, but the result was never recorded (the server may have stopped). It is not run again. Check the document before relying on it.'
            : status === 'approved'
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
  reading: 'Reading the mentioned documents…',
  answering: 'Writing the answer…',
  thinking: 'Working on it…',
}

const toolStates = {
  running: 'running',
  done: 'done',
  failed: 'failed',
  waiting: 'waiting for your approval',
} as const

/**
 * A question as the User wrote it: the documents it names show as their names,
 * linked while the User can still read them. The token itself is never shown.
 */
function QuestionText({
  content,
  workspaceID,
  mentions = [],
}: {
  content: string
  /** Without a workspace there is nothing to link to, so names stay plain. */
  workspaceID?: string
  mentions?: RAGMessage['mentions']
}) {
  return (
    <p className='text-sm whitespace-pre-wrap'>
      {messageParts(content).map((part, index) => {
        if (part.kind === 'text') return part.text
        const known = mentions?.find(
          (item) => item.documentId === part.documentID
        )
        const title = known?.title ?? part.label
        if (known && !known.available)
          return (
            <span
              key={index}
              title='No longer available to you'
              className='rounded bg-muted px-1 text-muted-foreground line-through'
            >
              @{title}
              <span className='sr-only'> (unavailable)</span>
            </span>
          )
        const chip = 'rounded bg-background/70 px-1 font-medium'
        return workspaceID ? (
          <a
            key={index}
            href={`/docs/${part.documentID}?workspaceId=${workspaceID}`}
            className={`${chip} text-primary underline-offset-4 hover:underline`}
          >
            <span aria-hidden='true'>@</span>
            {title}
          </a>
        ) : (
          <span key={index} className={chip}>
            @{title}
          </span>
        )
      })}
    </p>
  )
}

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
          <QuestionText content={view.question} />
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
            {view.phase === 'running' ? (
              <span
                data-activity='caret'
                aria-hidden='true'
                className='ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-[caret-blink_1s_steps(1,end)_infinite] bg-foreground motion-reduce:animate-none'
              />
            ) : null}
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
          <p
            role='status'
            className='flex items-center gap-2 text-xs text-muted-foreground'
          >
            <span
              data-activity='dots'
              aria-hidden='true'
              className='flex items-center gap-1'
            >
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  className='size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none'
                  style={{ animationDelay: `${dot * 200}ms` }}
                />
              ))}
            </span>
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
        <QuestionText
          content={message.content}
          workspaceID={workspaceID}
          mentions={message.mentions}
        />
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
  workspaceID,
  onAsk,
  onStop,
  language,
  onLanguage,
}: {
  id: string
  pending: boolean
  error?: Error | null
  placeholder: string
  /** Where @ looks for documents to name; without it @ is plain text. */
  workspaceID?: string
  onAsk: (question: string) => void
  /** Stops the answer being written; while it runs the form offers Stop in place of Send. */
  onStop?: () => void
  language: 'id' | 'en'
  onLanguage: (language: 'id' | 'en') => void
}) {
  const [question, setQuestion] = useState('')
  const [placed, setPlaced] = useState<PlacedDocumentMention[]>([])
  const [caret, setCaret] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
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
  const naming =
    workspaceID && matches.length === 0
      ? activeMentionQuery(question, caret, placed)
      : null
  const picking = naming && naming.start !== dismissedAt ? naming : null
  const named = new Set(placed.map((mention) => mention.documentID))
  const atLimit = named.size >= MAX_DOCUMENT_MENTIONS
  const search = useDebouncedValue(picking?.query ?? '', 200)
  const found = useQuery({
    queryKey: ['chat-document-search', workspaceID, search],
    queryFn: ({ signal }) => searchChatDocuments(workspaceID!, search, signal),
    enabled: Boolean(picking && !atLimit),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 30_000,
  })
  const documents = picking && !atLimit ? (found.data ?? []) : []
  const choices = matches.length > 0 ? matches.length : documents.length
  const [highlighted, setHighlighted] = useState(0)
  const active = Math.min(highlighted, Math.max(choices - 1, 0))
  const placeCaret = (position: number) => {
    setCaret(position)
    requestAnimationFrame(() => {
      box.current?.focus()
      box.current?.setSelectionRange(position, position)
    })
  }
  const chooseSkill = (name: string) => {
    const next = `/${name} `
    setQuestion(next)
    // Keep typing after the skill name.
    placeCaret(next.length)
  }
  const chooseDocument = (hit: ChatDocumentHit) => {
    if (!picking) return
    const label = documentLabel(hit.title)
    const inserted = `@${label} `
    const next =
      question.slice(0, picking.start) + inserted + question.slice(caret)
    const delta = next.length - question.length
    setQuestion(next)
    setPlaced([
      ...placed.map((mention) =>
        mention.start >= caret
          ? {
              ...mention,
              start: mention.start + delta,
              end: mention.end + delta,
            }
          : mention
      ),
      {
        documentID: hit.id.toLowerCase(),
        label,
        start: picking.start,
        end: picking.start + 1 + label.length,
      },
    ])
    placeCaret(picking.start + inserted.length)
  }
  const choose = (index: number) => {
    if (matches.length > 0) chooseSkill(matches[index]!.name)
    else if (documents[index]) chooseDocument(documents[index])
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter confirms an input-method candidate; it is not a send.
    if (event.nativeEvent.isComposing || event.key === 'Process') return
    const plainEnter = event.key === 'Enter' && !event.shiftKey
    if (choices > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : choices - 1
        setHighlighted((active + step) % choices)
      } else if (plainEnter || event.key === 'Tab') {
        event.preventDefault()
        choose(active)
      } else if (event.key === 'Escape' && picking) {
        event.preventDefault()
        setDismissedAt(picking.start)
      }
      return
    }
    // A touch keyboard has no Shift, so there Enter stays a new line and Send is the button.
    if (plainEnter && !window.matchMedia('(pointer: coarse)').matches) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = serialize(question, placed).trim()
    if (!text || pending) return
    onAsk(text)
    setQuestion('')
    setPlaced([])
    setCaret(0)
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
        onChange={(event) => {
          const next = event.target.value
          setPlaced(trackEdit(placed, question, next))
          setQuestion(next)
          setCaret(event.target.selectionStart)
          setHighlighted(0)
          if (
            activeMentionQuery(next, event.target.selectionStart)?.start !==
            dismissedAt
          )
            setDismissedAt(null)
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        maxLength={10000}
        disabled={pending}
        className='min-h-20 resize-y'
      />
      {matches.length > 0 ? (
        <ul aria-label='Skills' className='mt-2 divide-y border-y text-sm'>
          {matches.map((skill, index) => (
            <li key={skill.id}>
              <button
                type='button'
                aria-current={index === active ? 'true' : undefined}
                className='w-full px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=true]:bg-accent'
                onClick={() => chooseSkill(skill.name)}
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
      {picking && atLimit ? (
        <p role='status' className='mt-2 text-xs text-muted-foreground'>
          You can mention up to {MAX_DOCUMENT_MENTIONS} documents in one
          question.
        </p>
      ) : null}
      {picking && !atLimit ? (
        documents.length > 0 ? (
          <ul aria-label='Documents' className='mt-2 divide-y border-y text-sm'>
            {documents.map((hit, index) => (
              <li key={hit.id}>
                <button
                  type='button'
                  aria-current={index === active ? 'true' : undefined}
                  className='w-full px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=true]:bg-accent'
                  // Keep focus in the box so the caret stays where the @ was typed.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseDocument(hit)}
                >
                  <span className='font-medium'>{hit.title || 'Untitled'}</span>
                  {hit.projectName ? (
                    <span className='ml-2 text-xs text-muted-foreground'>
                      {hit.projectName}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p role='status' className='mt-2 text-xs text-muted-foreground'>
            {found.isFetching ? 'Searching documents…' : 'No document matches.'}
          </p>
        )
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
