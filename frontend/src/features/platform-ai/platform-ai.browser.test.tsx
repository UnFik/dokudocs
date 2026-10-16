import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { sseFrame, sseResponse } from '@/test-utils/sse'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { PlatformAiPage } from '.'

const key = (url: string, init: RequestInit = {}) =>
  `${init.method ?? 'GET'} ${new URL(url).pathname}`

const answer = {
  purpose: 'answer',
  baseURL: 'https://api.example.com/v1',
  protocol: 'openai_chat_completions',
  model: 'gpt-answer',
  keyHint: '••••abcd',
  updatedBy: null,
  updatedAt: '2026-10-11T10:00:00Z',
  lastError: '',
  lastErrorAt: null,
}
const embedding = {
  ...answer,
  purpose: 'embedding',
  protocol: 'openai_responses',
  model: 'text-embedding-small',
  keyHint: '••••wxyz',
}

function overview(extra: Record<string, unknown> = {}) {
  return {
    answer,
    embedding,
    embeddingPending: null,
    progress: null,
    ...extra,
  }
}

const runID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'
const runBase = { id: runID, kind: 'test', draft: '', sequence: 3 }

/** The routes of a test or save job that ends as given. */
function job(
  purpose: string,
  operation: 'test' | 'save',
  end:
    | { streaming: 'supported' | 'unsupported' | 'unverified' }
    | { error: string }
) {
  const done =
    'error' in end
      ? { ...runBase, kind: operation, status: 'failed', error: end.error }
      : {
          ...runBase,
          kind: operation,
          status: 'completed',
          result: { operation, streaming: end.streaming },
        }
  return {
    [`POST /api/v1/platform/ai/${purpose}/runs`]: () =>
      jsonResponse(
        { ...runBase, kind: operation, status: 'running', sequence: 0 },
        202
      ),
    [`GET /api/v1/ai/runs/${runID}/events`]: () =>
      sseResponse([
        sseFrame(1, 'status', { phase: 'testing' }),
        sseFrame(3, done.status, done),
      ]),
  }
}

function api(answers: Record<string, () => Response>, changes: unknown[] = []) {
  return vi.fn((url: string, init?: RequestInit) => {
    const route = key(url, init)
    if (answers[route]) return Promise.resolve(answers[route]())
    if (route === 'GET /api/v1/platform/ai/changes')
      return Promise.resolve(jsonResponse({ changes }))
    return Promise.resolve(jsonResponse({ title: 'not found' }, 404))
  })
}
const calls = (fetch: ReturnType<typeof vi.fn>, route: string) =>
  fetch.mock.calls.filter(([url, init]) => key(url, init) === route)

function mount() {
  useAuthStore.getState().auth.setSession(testSession())
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PlatformAiPage />
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

it('shows both settings with only the end of each key', async () => {
  vi.stubGlobal(
    'fetch',
    api({ 'GET /api/v1/platform/ai': () => jsonResponse(overview()) })
  )
  const screen = await mount()
  await expect
    .element(screen.getByLabelText('Answer model'))
    .toHaveValue('gpt-answer')
  await expect
    .element(screen.getByLabelText('Embedding model'))
    .toHaveValue('text-embedding-small')
  await expect.element(screen.getByText('••••abcd')).toBeVisible()
  await expect.element(screen.getByText('••••wxyz')).toBeVisible()
  expect(screen.getByLabelText('API key').elements()[0]).toHaveValue('')
})

it('says only a superadmin can open the page when the server refuses', async () => {
  vi.stubGlobal(
    'fetch',
    api({
      'GET /api/v1/platform/ai': () =>
        jsonResponse(
          { title: 'only a superadmin can change the AI provider' },
          403
        ),
    })
  )
  const screen = await mount()
  await expect
    .element(screen.getByText('Only a superadmin can open this page.'))
    .toBeVisible()
  expect(screen.getByLabelText('Answer model').elements()).toHaveLength(0)
})

it('tests a connection with the typed values and reports the result', async () => {
  const fetch = api({
    'GET /api/v1/platform/ai': () => jsonResponse(overview()),
    ...job('answer', 'test', { streaming: 'supported' }),
  })
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()
  const model = screen.getByLabelText('Answer model')
  await expect.element(model).toHaveValue('gpt-answer')
  await model.fill('gpt-new')
  await screen.getByLabelText('API key').first().fill('sk-typed-key')
  await screen.getByRole('button', { name: 'Test answer connection' }).click()
  await expect.element(screen.getByText(/Connection works\./)).toBeVisible()
  await expect
    .element(screen.getByText(/answers arrive as they are written/))
    .toBeVisible()
  const [, init] = calls(fetch, 'POST /api/v1/platform/ai/answer/runs')[0]
  expect(JSON.parse(String(init?.body))).toEqual({
    operation: 'test',
    baseURL: 'https://api.example.com/v1',
    protocol: 'openai_chat_completions',
    model: 'gpt-new',
    apiKey: 'sk-typed-key',
  })
  expect(new Headers(init?.headers).get('Idempotency-Key')).toBeTruthy()
})

it('keeps the form and shows why when the connection test fails on save', async () => {
  const fetch = api({
    'GET /api/v1/platform/ai': () => jsonResponse(overview()),
    ...job('answer', 'save', {
      error: 'The connection test failed: answer provider returned HTTP 401',
    }),
  })
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()
  await expect
    .element(screen.getByLabelText('Answer model'))
    .toHaveValue('gpt-answer')
  await screen.getByLabelText('Answer model').fill('gpt-new')
  await screen.getByRole('button', { name: 'Save answer provider' }).click()
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('answer provider returned HTTP 401')
  await expect
    .element(screen.getByLabelText('Answer model'))
    .toHaveValue('gpt-new')
})

it('explains a pending embedding model with its progress and what still answers', async () => {
  vi.stubGlobal(
    'fetch',
    api({
      'GET /api/v1/platform/ai': () =>
        jsonResponse(
          overview({
            embeddingPending: {
              ...embedding,
              model: 'text-embedding-large',
            },
            progress: { done: 30, total: 120 },
          })
        ),
    })
  )
  const screen = await mount()
  await expect.element(screen.getByText(/text-embedding-large/)).toBeVisible()
  await expect.element(screen.getByText('30 of 120 chunks')).toBeVisible()
  await expect
    .element(screen.getByText(/text-embedding-small keeps answering/))
    .toBeVisible()
})

it('moves the re-embedding counter as progress events arrive', async () => {
  vi.stubGlobal(
    'fetch',
    api({
      'GET /api/v1/platform/ai': () =>
        jsonResponse(
          overview({
            embeddingPending: { ...embedding, model: 'text-embedding-large' },
            progress: { done: 30, total: 120 },
          })
        ),
      'GET /api/v1/platform/ai/embedding/events': () =>
        sseResponse([
          `event: progress\ndata: ${JSON.stringify({ pending: true, model: 'text-embedding-large', done: 90, total: 120 })}\n\n`,
        ]),
    })
  )
  const screen = await mount()
  await expect.element(screen.getByText('90 of 120 chunks')).toBeVisible()
})

it('shows the outcome of the last test after the page was closed and opened again', async () => {
  vi.stubGlobal(
    'fetch',
    api({
      'GET /api/v1/platform/ai': () => jsonResponse(overview()),
      'GET /api/v1/platform/ai/answer/runs/latest': () =>
        jsonResponse({
          ...runBase,
          kind: 'test',
          status: 'completed',
          result: { operation: 'test', streaming: 'unverified' },
        }),
    })
  )
  const screen = await mount()
  await expect
    .element(screen.getByText(/Last test: connection worked/))
    .toBeVisible()
})

it('picks a job that is still running back up and refreshes when it ends', async () => {
  let finished = false
  const fetch = api({
    'GET /api/v1/platform/ai': () => jsonResponse(overview()),
    'GET /api/v1/platform/ai/answer/runs/latest': () =>
      jsonResponse(
        finished
          ? {
              ...runBase,
              kind: 'save',
              status: 'completed',
              result: { operation: 'save', streaming: 'supported' },
            }
          : { ...runBase, kind: 'save', status: 'running', sequence: 1 }
      ),
    [`GET /api/v1/ai/runs/${runID}/events`]: () => {
      finished = true
      return sseResponse([
        sseFrame(3, 'completed', {
          ...runBase,
          kind: 'save',
          status: 'completed',
          result: { operation: 'save', streaming: 'supported' },
        }),
      ])
    },
  })
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()
  await expect
    .element(screen.getByText(/Last save: connection worked/))
    .toBeVisible()
})

it('shows the last provider error the chatbot ran into', async () => {
  vi.stubGlobal(
    'fetch',
    api({
      'GET /api/v1/platform/ai': () =>
        jsonResponse(
          overview({
            answer: {
              ...answer,
              lastError: 'answer provider returned HTTP 500',
            },
          })
        ),
    })
  )
  const screen = await mount()
  await expect
    .element(screen.getByText('answer provider returned HTTP 500'))
    .toBeVisible()
})

it('lists recent changes without any key', async () => {
  vi.stubGlobal(
    'fetch',
    api({ 'GET /api/v1/platform/ai': () => jsonResponse(overview()) }, [
      {
        purpose: 'answer',
        changedBy: null,
        changedAt: '2026-10-11T10:00:00Z',
        changes: {
          model: { from: 'gpt-old', to: 'gpt-answer' },
          apiKey: { from: '', to: 'replaced' },
        },
      },
    ])
  )
  const screen = await mount()
  await expect.element(screen.getByText(/gpt-old/)).toBeVisible()
  await expect.element(screen.getByText(/API key replaced/)).toBeVisible()
})

it('shows the agent provider as a third setting and tests it on its own', async () => {
  const fetch = api({
    'GET /api/v1/platform/ai': () =>
      jsonResponse(
        overview({
          agent: {
            ...answer,
            purpose: 'agent',
            model: 'agent-model',
            keyHint: '••••9999',
          },
        })
      ),
    ...job('agent', 'test', { streaming: 'unsupported' }),
  })
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()
  await expect
    .element(screen.getByLabelText('Agent model', { exact: true }))
    .toHaveValue('agent-model')
  await expect.element(screen.getByText('••••9999')).toBeVisible()
  await screen.getByRole('button', { name: 'Test agent connection' }).click()
  await expect.element(screen.getByText(/Connection works\./)).toBeVisible()
  await expect
    .element(screen.getByText(/answered the streaming request with a whole/))
    .toBeVisible()
  expect(calls(fetch, 'POST /api/v1/platform/ai/agent/runs')).toHaveLength(1)
})

it('shows the small agent model as a setting of its own and tests it on its own', async () => {
  const fetch = api({
    'GET /api/v1/platform/ai': () =>
      jsonResponse(
        overview({
          agentSmall: {
            ...answer,
            purpose: 'agent_small',
            model: 'small-model',
            keyHint: '••••5555',
          },
        })
      ),
    ...job('agent_small', 'test', { streaming: 'supported' }),
  })
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()
  await expect
    .element(screen.getByLabelText('Small agent model'))
    .toHaveValue('small-model')
  await screen
    .getByRole('button', { name: 'Test small agent connection' })
    .click()
  await expect.element(screen.getByText(/Connection works\./)).toBeVisible()
  expect(
    calls(fetch, 'POST /api/v1/platform/ai/agent_small/runs')
  ).toHaveLength(1)
})

it('asks for a new key when the base URL changes, so the stored key is never sent to another address', async () => {
  const fetch = api({
    'GET /api/v1/platform/ai': () => jsonResponse(overview()),
  })
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()
  const url = screen.getByLabelText('Base URL').first()
  await expect.element(url).toHaveValue('https://api.example.com/v1')
  const save = screen.getByRole('button', { name: 'Save answer provider' })
  await url.fill('https://ai.other-provider.test/v1')
  await expect
    .element(screen.getByText(/Enter the API key for the new address/).first())
    .toBeVisible()
  await expect.element(save).toBeDisabled()
  await expect
    .element(screen.getByRole('button', { name: 'Test answer connection' }))
    .toBeDisabled()
  await screen.getByLabelText('API key').first().fill('sk-new-address')
  await expect.element(save).toBeEnabled()
  expect(calls(fetch, 'POST /api/v1/platform/ai/answer/runs')).toHaveLength(0)
})
