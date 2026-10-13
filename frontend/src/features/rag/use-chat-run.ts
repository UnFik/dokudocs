import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  cancelAIRun,
  followAIRun,
  getLatestChatRun,
  startChatRun,
  type AIRun,
  type AIRunEvent,
} from '@/lib/ai-runs'
import { noExtras, type QuestionExtras } from './question-extras'

export type ToolProgress = {
  name: string
  state: 'running' | 'done' | 'failed' | 'waiting'
  /** The document the call works on, when it names one. */
  documentId?: string
}

export type ChatRunView = {
  /** idle: nothing in progress. ended: the last run did not finish as an answer. */
  phase: 'idle' | 'starting' | 'running' | 'ended'
  runID: string | null
  question: string
  draft: string
  step: string
  tools: ToolProgress[]
  outcome: 'failed' | 'cancelled' | 'interrupted' | null
  message: string
  /** A request that never became a run, or a lost connection to one. */
  error: Error | null
}

const idle: ChatRunView = {
  phase: 'idle',
  runID: null,
  question: '',
  draft: '',
  step: '',
  tools: [],
  outcome: null,
  message: '',
  error: null,
}

type Action =
  | { type: 'reset' }
  | { type: 'starting'; question: string }
  | { type: 'attach'; run: AIRun; question?: string }
  | { type: 'event'; event: AIRunEvent }
  | { type: 'error'; error: Error }

function reduce(view: ChatRunView, action: Action): ChatRunView {
  switch (action.type) {
    case 'reset':
      return idle
    case 'starting':
      return { ...idle, phase: 'starting', question: action.question }
    case 'attach': {
      const { run } = action
      if (run.status === 'running')
        return {
          ...idle,
          phase: 'running',
          runID: run.id,
          question: action.question ?? '',
          draft: run.draft,
        }
      if (run.status === 'completed') return idle
      return ended(idle, run.id, run.status, run.draft, run.error)
    }
    case 'event':
      return applyEvent(view, action.event)
    case 'error':
      return { ...view, error: action.error }
  }
}

function ended(
  view: ChatRunView,
  runID: string | null,
  outcome: 'failed' | 'cancelled' | 'interrupted',
  draft: string,
  message: string
): ChatRunView {
  return { ...view, phase: 'ended', runID, outcome, draft, message }
}

function applyEvent(
  view: ChatRunView,
  { type, data }: AIRunEvent
): ChatRunView {
  const body = (data ?? {}) as Record<string, unknown>
  switch (type) {
    case 'snapshot': {
      const run = body as Partial<AIRun>
      return { ...view, draft: run.draft ?? view.draft }
    }
    case 'status': {
      const phase = typeof body.phase === 'string' ? body.phase : ''
      return { ...view, step: phase }
    }
    case 'text_delta':
      return { ...view, draft: view.draft + String(body.text ?? '') }
    case 'text_reset':
      return { ...view, draft: '' }
    case 'tool_status': {
      const name = String(body.name ?? '')
      const state = body.state as ToolProgress['state']
      const documentId =
        typeof body.documentId === 'string' && body.documentId
          ? body.documentId
          : undefined
      const others = view.tools.filter(
        (tool) => tool.name !== name || tool.documentId !== documentId
      )
      return { ...view, tools: [...others, { name, state, documentId }] }
    }
    case 'failed':
    case 'cancelled':
    case 'interrupted': {
      const run = body as Partial<AIRun>
      return ended(
        view,
        view.runID,
        type,
        run.draft ?? view.draft,
        run.error ?? ''
      )
    }
    default:
      return view
  }
}

/**
 * The answer being written in one conversation. The work runs in the server, so
 * this picks it up again when the panel opens, the page reloads or another tab
 * started it. A finished answer is read from the chat history, never from here.
 */
export function useChatRun({
  conversationID,
  workspaceID,
  language,
  onAnswered,
}: {
  conversationID: string | undefined
  workspaceID: string
  language: 'id' | 'en'
  /** Called once the answer is saved, so the history can be read again. */
  onAnswered: () => Promise<unknown> | void
}) {
  const [view, dispatch] = useReducer(reduce, idle)
  const watching = useRef<AbortController | null>(null)
  const retry = useRef<{ identity: string; key: string } | null>(null)
  const answered = useRef(onAnswered)
  useEffect(() => {
    answered.current = onAnswered
  })

  const watch = useCallback((run: AIRun, question?: string) => {
    watching.current?.abort()
    const controller = new AbortController()
    watching.current = controller
    dispatch({ type: 'attach', run, question })
    if (run.status !== 'running') return
    followAIRun(run.id, {
      after: 0,
      signal: controller.signal,
      onEvent: (event) => {
        if (controller.signal.aborted) return
        if (event.type === 'completed') {
          void Promise.resolve(answered.current()).finally(() => {
            if (!controller.signal.aborted) dispatch({ type: 'reset' })
          })
          return
        }
        dispatch({ type: 'event', event })
      },
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return
      dispatch({
        type: 'error',
        error: reason instanceof Error ? reason : new Error('Request failed'),
      })
    })
  }, [])

  useEffect(() => {
    dispatch({ type: 'reset' })
    retry.current = null
    if (!conversationID) return
    const controller = new AbortController()
    getLatestChatRun(conversationID, controller.signal)
      .then((run) => {
        if (run && !controller.signal.aborted) watch(run)
      })
      .catch(() => undefined)
    return () => {
      controller.abort()
      watching.current?.abort()
    }
  }, [conversationID, watch])

  const ask = useCallback(
    async (
      question: string,
      publicLinkTokens?: string[],
      extras: QuestionExtras = noExtras
    ) => {
      if (!conversationID) return
      // The same question after a failed start reuses its key, so a lost reply
      // does not start a second answer. Other categories, chats or files make it another question.
      const identity = JSON.stringify([question, extras])
      const key =
        retry.current?.identity === identity
          ? retry.current.key
          : crypto.randomUUID()
      retry.current = { identity, key }
      dispatch({ type: 'starting', question })
      try {
        const run = await startChatRun(
          workspaceID,
          conversationID,
          {
            question,
            language,
            publicLinkTokens,
            categoryIds: extras.categoryIds,
            contextChatIds: extras.contextChatIds,
            attachments: extras.attachments,
          },
          key
        )
        retry.current = null
        watch(run, question)
      } catch (reason) {
        dispatch({
          type: 'error',
          error: reason instanceof Error ? reason : new Error('Request failed'),
        })
      }
    },
    [conversationID, workspaceID, language, watch]
  )

  const stop = useCallback(async () => {
    if (!view.runID) return
    try {
      await cancelAIRun(view.runID)
    } catch (reason) {
      dispatch({
        type: 'error',
        error: reason instanceof Error ? reason : new Error('Request failed'),
      })
    }
  }, [view.runID])

  return {
    view,
    error: view.error,
    busy: view.phase === 'starting' || view.phase === 'running',
    ask,
    stop,
  }
}
