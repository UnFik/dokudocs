import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Link2,
  Square,
  X,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
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
  getRAGUsage,
  listRAGCategories,
  listWorkspaces,
  type RAGCategory,
  listSkills,
  searchChatDocuments,
  type AgentAction,
  type ChatDocumentHit,
  type RAGCitation,
  type RAGMessage,
} from '@/lib/domain-api'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { AddContextMenu, type ContextChat } from './add-context-menu'
import { resetLabel } from './conversation-format'
import { documentIdsIn } from './markdown/answer-links'
import { AnswerText } from './markdown/answer-text'
import {
  DocumentCard,
  DocumentReferences,
  ToolChip,
} from './markdown/document-references'
import {
  MAX_CATEGORIES,
  MAX_CONTEXT_CHATS,
  MAX_FILES,
  readAttachments,
  type Attachment,
  type QuestionExtras,
} from './question-extras'
import { UsageRing } from './usage-ring'
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
        <span className='font-medium whitespace-pre-line'>
          {action.summary}
        </span>
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

/**
 * The changes of earlier turns that were already decided, folded to one line so a long
 * chat does not keep showing old failures. Opening the line shows every card again.
 */
function EarlierActions({
  actions,
  conversationID,
  queryKey,
}: {
  actions: AgentAction[]
  conversationID: string
  queryKey: readonly unknown[]
}) {
  const [open, setOpen] = useState(false)
  const listID = useId()
  const failed = actions.filter((action) => action.status === 'failed').length
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className='space-y-3'>
      <Button
        type='button'
        variant='ghost'
        size='sm'
        className='text-muted-foreground'
        aria-expanded={open}
        aria-controls={listID}
        onClick={() => setOpen((value) => !value)}
      >
        <Chevron />
        {actions.length === 1
          ? '1 earlier change'
          : `${actions.length} earlier changes`}
        {failed > 0 ? (
          <span className='flex items-center gap-1.5 text-destructive'>
            <span
              aria-hidden
              className='size-1.5 rounded-[1px] bg-destructive'
            />
            {failed} failed
          </span>
        ) : null}
      </Button>
      <div id={listID} hidden={!open} className='space-y-3'>
        {open
          ? actions.map((action) => (
              <AgentActionCard
                key={action.id}
                action={action}
                conversationID={conversationID}
                queryKey={queryKey}
              />
            ))
          : null}
      </div>
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
      {messages.map((message, index) => {
        const own = (message.meta?.actions ?? [])
          .map((id) => actions.find((action) => action.id === id))
          .filter((action): action is AgentAction => Boolean(action))
        own.forEach((action) => placed.add(action.id))
        // The newest turn and anything still waiting for the User stay open.
        const past = index < messages.length - 1
        const settled = past
          ? own.filter((action) => action.status !== 'pending')
          : []
        const shown = own.filter((action) => !settled.includes(action))
        return (
          <div key={message.id} className='space-y-3'>
            <ChatMessage message={message} workspaceID={workspaceID} />
            {settled.length > 0 ? (
              <EarlierActions
                actions={settled}
                conversationID={conversationID}
                queryKey={queryKey}
              />
            ) : null}
            {shown.map((action) => (
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
export function RunProgress({
  view,
  workspaceID,
}: {
  view: ChatRunView
  /** Where the documents it names are looked up; without it they stay plain. */
  workspaceID?: string
}) {
  if (view.phase === 'idle') return null
  const ending = view.outcome ? endings[view.outcome] : null
  const named = [
    ...view.tools.flatMap((tool) => (tool.documentId ? [tool.documentId] : [])),
    ...documentIdsIn(view.draft),
  ]
  return (
    <DocumentReferences workspaceID={workspaceID} ids={named}>
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
            <div
              className={view.phase === 'ended' ? 'text-muted-foreground' : ''}
            >
              <AnswerText
                content={view.draft}
                streaming={view.phase === 'running'}
              />
              {view.phase === 'running' ? (
                <span
                  data-activity='caret'
                  aria-hidden='true'
                  className='mt-1 inline-block h-4 w-0.5 animate-[caret-blink_1s_steps(1,end)_infinite] bg-foreground motion-reduce:animate-none'
                />
              ) : null}
            </div>
          ) : null}
          {view.tools.length > 0 ? (
            <ul className='flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground'>
              {view.tools.map((tool) => (
                <li
                  key={`${tool.name}:${tool.documentId ?? ''}`}
                  className='flex items-center gap-1.5'
                >
                  <ToolChip
                    name={tool.name}
                    documentID={tool.documentId}
                    suffix={toolStates[tool.state]}
                  />
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
    </DocumentReferences>
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

  const calls = toolCallsOf(message)
  const named = [
    ...calls.flatMap((call) => (call.documentId ? [call.documentId] : [])),
    ...documentIdsIn(message.content),
  ]
  return (
    <DocumentReferences workspaceID={workspaceID} ids={named}>
      <article className='max-w-4xl space-y-3'>
        <h3 className='font-mono text-[11px] text-muted-foreground'>
          dokudocs ai{message.meta?.skill ? ` · /${message.meta.skill}` : ''}
        </h3>
        {/* Markdown built as elements: images never load, and outside links open in a new tab. */}
        <AnswerText content={message.content} />
        {calls.length > 0 ? (
          <p className='flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground'>
            Tools used:
            {calls.map((call) => (
              <span
                key={`${call.name}:${call.documentId ?? ''}`}
                className='inline-flex items-center gap-1.5'
              >
                <ToolChip name={call.name} documentID={call.documentId} />
              </span>
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
    </DocumentReferences>
  )
}

/** The tool calls of an answer, each tool once per document; older answers only kept the names. */
function toolCallsOf(message: RAGMessage) {
  const calls =
    message.meta?.calls ??
    (message.meta?.tools ?? []).map((name) => ({
      name,
      documentId: undefined,
    }))
  const seen = new Set<string>()
  return calls.filter((call) => {
    const key = `${call.name}:${call.documentId ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function Citation({
  citation,
  workspaceID,
}: {
  citation: RAGCitation
  workspaceID: string
}) {
  if (citation.unavailable)
    return (
      <li className='rounded-md border bg-background p-3 text-xs text-muted-foreground'>
        <span className='font-medium'>Document not available</span>
        <p className='mt-1'>You no longer have access to this source.</p>
      </li>
    )
  const href = `/docs/${encodeURIComponent(citation.documentId)}?workspaceId=${encodeURIComponent(workspaceID)}&nodeId=${encodeURIComponent(citation.nodeId)}#node-${encodeURIComponent(citation.nodeId)}`
  return (
    <li className='rounded-md border bg-background p-3 text-xs'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <span className='font-medium'>
          {citation.documentTitle || 'Workspace document'}
          {citation.projectName ? ` · ${citation.projectName}` : ''}
          {citation.breadcrumb ? ` · ${citation.breadcrumb}` : ''}
        </span>
        <DocumentCard
          workspaceID={workspaceID}
          hit={{
            id: citation.documentId,
            title: citation.documentTitle || 'Workspace document',
            projectName: citation.projectName ?? '',
          }}
        >
          <a
            href={href}
            className='inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline'
          >
            <Link2 className='size-3.5' />
            Open block
          </a>
        </DocumentCard>
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

// The lists open above the box: it sits at the bottom of the chat, and a list
// below it would push Send off the screen. Floating is what earns the shadow.
const floatingList =
  'absolute inset-x-0 bottom-full z-20 mb-1 max-h-64 divide-y overflow-y-auto rounded-md border bg-popover text-sm text-popover-foreground shadow-md'
const floatingNote =
  'absolute inset-x-0 bottom-full z-20 mb-1 rounded-md border bg-popover px-2 py-1.5 text-xs text-muted-foreground shadow-md'
const listRow =
  'w-full px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=true]:bg-accent'

const documentTypes: Record<string, string> = {
  markdown: 'Markdown',
  dbdiagram: 'DBML',
  mermaid: 'Mermaid',
  architecture: 'Architecture',
}
const shownCategories = 2

/** The second line of a picker row: project, type and the first categories; the title attribute holds them all. */
function documentDetails(hit: ChatDocumentHit) {
  const project = hit.projectName || 'No project'
  const type = documentTypes[hit.type] ?? hit.type
  const extra = hit.categories.length - shownCategories
  const shown = hit.categories.slice(0, shownCategories).join(', ')
  const categories = shown && extra > 0 ? `${shown} +${extra}` : shown
  return {
    short: [project, type, categories].filter(Boolean).join(' · '),
    full: [project, type, hit.categories.join(', ')]
      .filter(Boolean)
      .join(' · '),
  }
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
  scope = 'workspace',
  chats = [],
  draft,
}: {
  id: string
  pending: boolean
  error?: Error | null
  placeholder: string
  /** Where @ looks for documents to name; without it @ is plain text. */
  workspaceID?: string
  onAsk: (question: string, extras: QuestionExtras) => void
  /** Stops the answer being written; while it runs the form offers Stop in place of Send. */
  onStop?: () => void
  language: 'id' | 'en'
  onLanguage: (language: 'id' | 'en') => void
  /** A document chat has no Category to narrow by. */
  scope?: 'document' | 'workspace'
  /** Other chats of the User that can be brought in as context (not the open one). */
  chats?: ContextChat[]
  /**
   * The files held for the question by whoever owns the page, so text added from
   * the document is kept while the chat is shut. `focusRequest` going up moves
   * the caret into the box.
   */
  draft?: {
    attachments: Attachment[]
    onChange: (attachments: Attachment[]) => void
    focusRequest: number
    /** A question the page puts in the box; a new `id` replaces what is typed. */
    prefill?: { text: string; id: number }
  }
}) {
  const [question, setQuestion] = useState('')
  const [categories, setCategories] = useState<RAGCategory[]>([])
  const [contextChats, setContextChats] = useState<ContextChat[]>([])
  const [ownAttachments, setOwnAttachments] = useState<Attachment[]>([])
  const attachments = draft?.attachments ?? ownAttachments
  const setAttachments = draft?.onChange ?? setOwnAttachments
  const [fileError, setFileError] = useState<string>()
  const [placed, setPlaced] = useState<PlacedDocumentMention[]>([])
  const [caret, setCaret] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const focusRequest = draft?.focusRequest ?? 0
  useEffect(() => {
    if (focusRequest > 0) box.current?.focus()
  }, [focusRequest])
  const prefill = draft?.prefill
  useEffect(() => {
    if (!prefill || prefill.id === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuestion(prefill.text)
    setPlaced([])
    setCaret(prefill.text.length)
  }, [prefill])
  const skills = useQuery({
    queryKey: ['skills'],
    queryFn: ({ signal }) => listSkills(signal),
    retry: false,
    staleTime: 60_000,
  })
  const userID = useAuthStore((state) => state.auth.user?.id ?? '')
  const usage = useQuery({
    queryKey: ['rag-usage', workspaceID],
    queryFn: ({ signal }) => getRAGUsage(workspaceID!, signal),
    enabled: Boolean(workspaceID),
    retry: false,
    staleTime: 30_000,
  })
  const categoryList = useQuery({
    queryKey: ['rag-categories', workspaceID],
    queryFn: ({ signal }) => listRAGCategories(workspaceID!, signal),
    enabled: scope === 'workspace' && Boolean(workspaceID),
    retry: false,
    staleTime: 60_000,
  })
  const spent = Boolean(usage.data && usage.data.used >= usage.data.limit)
  const workspaces = useQuery({
    queryKey: ['workspaces', userID],
    queryFn: ({ signal }) => listWorkspaces(signal),
    enabled: spent && Boolean(userID),
    retry: false,
    staleTime: 60_000,
  })
  const isOwner =
    workspaces.data?.find((workspace) => workspace.id === workspaceID)?.role ===
    'owner'
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
    onAsk(text, {
      categoryIds: categories.map((category) => category.id),
      contextChatIds: contextChats.map((chat) => chat.id),
      attachments,
    })
    setCategories([])
    setContextChats([])
    setAttachments([])
    setFileError(undefined)
    setQuestion('')
    setPlaced([])
    setCaret(0)
  }
  return (
    <form onSubmit={submit} className='border-t p-3'>
      <div className='relative'>
        <div className='rounded-md border border-input bg-card focus-within:ring-2 focus-within:ring-ring'>
          {categories.length + contextChats.length + attachments.length > 0 ? (
            <ul
              aria-label='Added to this question'
              className='flex flex-wrap gap-1.5 px-2 pt-2'
            >
              {categories.map((category) => (
                <ContextChip
                  key={category.id}
                  label={category.name}
                  remove={`Remove category ${category.name}`}
                  onRemove={() =>
                    setCategories(
                      categories.filter((c) => c.id !== category.id)
                    )
                  }
                />
              ))}
              {contextChats.map((chat) => (
                <ContextChip
                  key={chat.id}
                  label={chat.title || 'Untitled chat'}
                  remove={`Remove chat ${chat.title || 'Untitled chat'}`}
                  onRemove={() =>
                    setContextChats(
                      contextChats.filter((c) => c.id !== chat.id)
                    )
                  }
                />
              ))}
              {attachments.map((file) => (
                <ContextChip
                  key={file.name}
                  label={file.name}
                  remove={`Remove file ${file.name}`}
                  onRemove={() =>
                    setAttachments(
                      attachments.filter((a) => a.name !== file.name)
                    )
                  }
                />
              ))}
            </ul>
          ) : null}
          <Textarea
            ref={box}
            id={id}
            aria-label='Ask a question'
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
            className='min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:border-transparent focus-visible:ring-0'
          />
          <div className='flex items-center justify-between px-2 pb-2'>
            <AddContextMenu
              skills={skills.data ?? []}
              chats={chats.filter(
                (chat) => !contextChats.some((chosen) => chosen.id === chat.id)
              )}
              categories={(categoryList.data ?? []).filter(
                (category) =>
                  !categories.some((chosen) => chosen.id === category.id)
              )}
              scope={scope}
              disabled={pending}
              chatsFull={contextChats.length >= MAX_CONTEXT_CHATS}
              categoriesFull={categories.length >= MAX_CATEGORIES}
              filesFull={attachments.length >= MAX_FILES}
              onPickSkill={chooseSkill}
              onPickChat={(chat) => setContextChats([...contextChats, chat])}
              onPickCategory={(category) =>
                setCategories([...categories, category])
              }
              onFiles={(files) => {
                void readAttachments(files, attachments).then((result) => {
                  setAttachments(result.attachments)
                  setFileError(result.error)
                })
              }}
            />
            {pending && onStop ? (
              <Button
                type='button'
                size='icon'
                variant='outline'
                aria-label='Stop'
                onClick={onStop}
                className='size-8 max-sm:size-11'
              >
                <Square />
              </Button>
            ) : (
              <Button
                type='submit'
                size='icon'
                aria-label='Send'
                disabled={pending || spent || !question.trim()}
                className='size-8 max-sm:size-11'
              >
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
        {matches.length > 0 ? (
          <ul aria-label='Skills' className={floatingList}>
            {matches.map((skill, index) => (
              <li key={skill.id}>
                <button
                  type='button'
                  aria-current={index === active ? 'true' : undefined}
                  className={listRow}
                  // Keep focus in the box so the caret stays put.
                  onMouseDown={(event) => event.preventDefault()}
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
          <p role='status' className={floatingNote}>
            You can mention up to {MAX_DOCUMENT_MENTIONS} documents in one
            question.
          </p>
        ) : null}
        {picking && !atLimit ? (
          documents.length > 0 ? (
            <ul aria-label='Documents' className={floatingList}>
              {documents.map((hit, index) => {
                const details = documentDetails(hit)
                return (
                  <li key={hit.id}>
                    <button
                      type='button'
                      aria-current={index === active ? 'true' : undefined}
                      className={listRow}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseDocument(hit)}
                    >
                      <span className='block truncate font-medium'>
                        {hit.title || 'Untitled'}
                      </span>
                      <span
                        title={details.full}
                        className='block truncate text-xs text-muted-foreground'
                      >
                        {details.short}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p role='status' className={floatingNote}>
              {found.isFetching
                ? 'Searching documents…'
                : 'No document matches.'}
            </p>
          )
        ) : null}
      </div>
      <div className='mt-2 flex items-center justify-between gap-2'>
        <label className='flex min-w-0 items-center gap-2 text-xs text-muted-foreground'>
          <span className='sr-only'>Answer language</span>
          <select
            aria-label='Answer language'
            value={language}
            onChange={(event) => onLanguage(event.target.value as 'id' | 'en')}
            className='h-8 rounded-md border border-input bg-card px-2 text-xs text-foreground max-sm:h-11'
          >
            <option value='en'>English</option>
            <option value='id'>Bahasa Indonesia</option>
          </select>
        </label>
        {usage.data ? <UsageRing usage={usage.data} /> : null}
      </div>
      {fileError ? (
        <p role='alert' className='mt-2 text-sm text-destructive'>
          {fileError}
        </p>
      ) : null}
      {spent && usage.data ? (
        <p role='status' className='mt-2 text-sm text-muted-foreground'>
          This month&apos;s AI limit is spent. It resets on{' '}
          {resetLabel(usage.data.resetsAt)}. Your chats stay readable.{' '}
          {isOwner ? (
            <a
              href='/settings'
              className='font-medium text-foreground underline underline-offset-2'
            >
              Manage the plan
            </a>
          ) : (
            'Ask an Owner of this workspace to upgrade the plan.'
          )}
        </p>
      ) : null}
      {error ? (
        <p role='alert' className='mt-2 text-sm text-destructive'>
          {error.message}
        </p>
      ) : null}
    </form>
  )
}

/** One thing added to the question being written, with a way to take it off. */
function ContextChip({
  label,
  remove,
  onRemove,
}: {
  label: string
  remove: string
  onRemove: () => void
}) {
  return (
    <li className='flex max-w-full items-center gap-1 rounded-sm bg-border py-0.5 ps-2 pe-0.5 font-mono text-[11px]'>
      <span className='truncate'>{label}</span>
      <button
        type='button'
        aria-label={remove}
        onClick={onRemove}
        className='inline-flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-sm:size-8'
      >
        <X className='size-3.5' aria-hidden='true' />
      </button>
    </li>
  )
}
