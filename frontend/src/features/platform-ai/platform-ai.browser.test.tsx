import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
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
    'POST /api/v1/platform/ai/answer/test': () => jsonResponse({ ok: true }),
  })
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()
  const model = screen.getByLabelText('Answer model')
  await expect.element(model).toHaveValue('gpt-answer')
  await model.fill('gpt-new')
  await screen.getByLabelText('API key').first().fill('sk-typed-key')
  await screen.getByRole('button', { name: 'Test answer connection' }).click()
  await expect.element(screen.getByText('Connection works.')).toBeVisible()
  const [, init] = calls(fetch, 'POST /api/v1/platform/ai/answer/test')[0]
  expect(JSON.parse(String(init?.body))).toEqual({
    baseURL: 'https://api.example.com/v1',
    protocol: 'openai_chat_completions',
    model: 'gpt-new',
    apiKey: 'sk-typed-key',
  })
})

it('keeps the form and shows why when the connection test fails on save', async () => {
  const fetch = api({
    'GET /api/v1/platform/ai': () => jsonResponse(overview()),
    'PUT /api/v1/platform/ai/answer': () =>
      jsonResponse(
        {
          title:
            'The connection test failed: answer provider returned HTTP 401',
          code: 'connection_failed',
        },
        422
      ),
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
    'POST /api/v1/platform/ai/agent/test': () => jsonResponse({ ok: true }),
  })
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()
  await expect
    .element(screen.getByLabelText('Agent model'))
    .toHaveValue('agent-model')
  await expect.element(screen.getByText('••••9999')).toBeVisible()
  await screen.getByRole('button', { name: 'Test agent connection' }).click()
  await expect.element(screen.getByText('Connection works.')).toBeVisible()
  expect(calls(fetch, 'POST /api/v1/platform/ai/agent/test')).toHaveLength(1)
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
  expect(calls(fetch, 'POST /api/v1/platform/ai/answer/test')).toHaveLength(0)
})
