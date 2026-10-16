import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { PlatformConversationsPage } from '.'

const route = (url: string, init: RequestInit = {}) =>
  `${init.method ?? 'GET'} ${new URL(url, 'http://x').pathname}`
const RUN = '11111111-1111-4111-8111-111111111111'
const graph = {
  nodes: [
    { id: 'input', label: 'Input teks', kind: 'step', x: 0, y: 0 },
    { id: 'context', label: 'Ekstraksi + konteks', kind: 'step', x: 1, y: 0 },
    { id: 'gate', label: 'Guardrails', kind: 'decision', x: 2, y: 0 },
    { id: 'reject', label: 'Tolak', kind: 'end', x: 3, y: 0 },
    { id: 'route', label: 'Router model', kind: 'decision', x: 1, y: 1 },
    { id: 'model_large', label: 'Model utama', kind: 'model', x: 1, y: 2 },
    { id: 'tools', label: 'Tool', kind: 'tool', x: 0, y: 3 },
    { id: 'respond', label: 'Respons', kind: 'end', x: 2, y: 3 },
  ],
  edges: [
    { from: 'input', to: 'context', label: '' },
    { from: 'context', to: 'gate', label: '' },
    { from: 'gate', to: 'reject', label: 'Di luar domain' },
    { from: 'gate', to: 'route', label: 'Aman' },
    { from: 'route', to: 'model_large', label: 'Edit / umum' },
    { from: 'model_large', to: 'tools', label: 'Query atau aksi' },
    { from: 'tools', to: 'model_large', label: 'Hasil tool' },
    { from: 'model_large', to: 'respond', label: 'Jawaban' },
  ],
}
const step = (seq: number, node: string, extra: object = {}) => ({
  seq,
  node,
  edge: '',
  status: 'ok',
  startedAt: '2026-10-16T10:00:00Z',
  durationMs: 0,
  model: '',
  tier: '',
  inputTokens: 0,
  outputTokens: 0,
  finishReason: '',
  tool: '',
  attempt: 0,
  reason: '',
  ...extra,
})
const summary = {
  runId: RUN,
  ownerId: 'b4d13df7-76a2-4da5-8817-91d40f832abd',
  ownerName: 'Alice Writer',
  ownerEmail: 'alice@example.com',
  workspaceId: null,
  conversationId: null,
  startedAt: '2026-10-16T10:00:00Z',
  steps: 7,
  modelCalls: 2,
  toolCalls: 1,
  inputTokens: 250,
  outputTokens: 60,
  durationMs: 770,
  outcome: 'respond',
  failed: false,
}
const detail = {
  ...summary,
  stepList: [
    step(1, 'input'),
    step(2, 'context'),
    step(3, 'gate', { edge: 'edit', reason: 'edit_verb', tier: 'rule' }),
    step(4, 'route', { edge: 'full', reason: 'edit' }),
    step(5, 'model_large', {
      edge: 'full',
      model: 'gpt-test',
      attempt: 1,
      inputTokens: 100,
      outputTokens: 20,
      finishReason: 'tool_calls',
      durationMs: 400,
    }),
    step(6, 'tools', { tool: 'list_documents', durationMs: 30 }),
    step(7, 'model_large', {
      edge: 'tool_result',
      attempt: 1,
      finishReason: 'stop',
      durationMs: 300,
    }),
    step(8, 'respond', { edge: 'answer' }),
  ],
  graph,
}
const controls = {
  gateEnabled: true,
  routerEnabled: true,
  traceRetentionDays: 30,
  updatedAt: '2026-10-16T09:00:00Z',
}

function mount() {
  useAuthStore.getState().auth.setSession(testSession())
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PlatformConversationsPage />
    </QueryClientProvider>
  )
}
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

function serve(
  extra: (
    key: string,
    url: string,
    init?: RequestInit
  ) => Response | null = () => null
) {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const key = route(url, init)
    const custom = extra(key, url, init)
    if (custom) return Promise.resolve(custom)
    if (key === 'GET /api/v1/platform/ai/runs')
      return Promise.resolve(jsonResponse({ runs: [summary], total: 1 }))
    if (key === `GET /api/v1/platform/ai/runs/${RUN}`)
      return Promise.resolve(jsonResponse(detail))
    if (key === 'GET /api/v1/platform/ai/harness')
      return Promise.resolve(jsonResponse(controls))
    return Promise.resolve(jsonResponse({}, 404))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

it('lists requests with who, how it ended and how long, and never a message', async () => {
  serve()
  const screen = await mount()
  await expect.element(screen.getByText('Alice Writer')).toBeVisible()
  await expect.element(screen.getByText('alice@example.com')).toBeVisible()
  await expect
    .element(screen.getByRole('cell', { name: 'respond' }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('cell', { name: '770 ms' }))
    .toBeVisible()
  await expect.element(screen.getByText('1 request')).toBeVisible()
  expect(
    screen
      .getByRole('columnheader', { name: /message|prompt|question|text/i })
      .query()
  ).toBeNull()
})

it('draws the path a request took through the decision graph and marks the places it went around', async () => {
  serve()
  const screen = await mount()
  await userEvent.click(
    await screen.getByRole('button', { name: 'Open trace' })
  )
  const graphImage = screen.getByRole('img', { name: 'Decision graph' })
  await expect.element(graphImage).toBeVisible()
  await expect
    .element(screen.getByLabelText('Guardrails, visited'))
    .toBeVisible()
  await expect
    .element(screen.getByLabelText('Tolak, not visited'))
    .toBeVisible()
  await expect
    .element(screen.getByLabelText('Model utama, visited 2 times'))
    .toBeVisible()
  const timeline = screen.getByRole('table', { name: 'Steps' })
  await expect.element(timeline.getByText('list_documents')).toBeVisible()
  await expect.element(timeline.getByText('edit_verb')).toBeVisible()
  await expect.element(timeline.getByText('gpt-test')).toBeVisible()
})

it('narrows the list by how the request ended, what it reached and whether it failed', async () => {
  const fetch = serve()
  const screen = await mount()
  await expect.element(screen.getByText('Alice Writer')).toBeVisible()
  await userEvent.selectOptions(screen.getByLabelText('Ended at'), 'reject')
  await userEvent.selectOptions(
    screen.getByLabelText('Passed through'),
    'tools'
  )
  await userEvent.click(screen.getByRole('checkbox', { name: 'Failed only' }))
  await expect
    .poll(() => {
      const last = fetch.mock.calls
        .map(([url]) => new URL(url, 'http://x'))
        .filter((u) => u.pathname === '/api/v1/platform/ai/runs')
        .at(-1)!
      return last.searchParams.toString()
    })
    .toBe('outcome=reject&node=tools&failed=true&limit=50&offset=0')
})

it('switches the entry gate off and keeps traces for fewer days', async () => {
  const fetch = serve((key, _url, init) =>
    key === 'PUT /api/v1/platform/ai/harness'
      ? jsonResponse({ ...controls, ...JSON.parse(String(init?.body)) })
      : null
  )
  const screen = await mount()
  await expect
    .element(screen.getByLabelText('Keep traces, in days'))
    .toHaveValue(30)
  await userEvent.click(
    screen.getByRole('switch', { name: 'Entry gate is on' })
  )
  await userEvent.fill(screen.getByLabelText('Keep traces, in days'), '14')
  await userEvent.click(screen.getByRole('button', { name: 'Save controls' }))
  await expect.element(screen.getByText('Controls saved.')).toBeVisible()
  const [, init] = fetch.mock.calls.find(
    ([url, i]) => route(url, i) === 'PUT /api/v1/platform/ai/harness'
  )!
  expect(JSON.parse(String(init?.body))).toMatchObject({
    gateEnabled: false,
    routerEnabled: true,
    traceRetentionDays: 14,
  })
})

it('tells a member that only a superadmin can open the page', async () => {
  serve(() => jsonResponse({ title: 'only a superadmin can do this' }, 403))
  const screen = await mount()
  await expect
    .element(screen.getByText('Only a superadmin can open this page.'))
    .toBeVisible()
})
