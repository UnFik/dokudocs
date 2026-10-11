import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { AIAccessPage } from '.'

const key = (url: string, init: RequestInit = {}) =>
  `${init.method ?? 'GET'} ${new URL(url).pathname}`

const catalog = [
  { key: 'read', label: 'Read', description: 'Search and read.' },
  {
    key: 'documents',
    label: 'Documents',
    description: 'Create and move documents.',
  },
  {
    key: 'content',
    label: 'Document content',
    description: 'Edit what a document says.',
  },
]
const keyRow = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  name: 'Laptop',
  prefix: 'dkd_abcdefgh',
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: '2026-10-11T10:00:00Z',
}

function api(overrides: Record<string, (init?: RequestInit) => Response> = {}) {
  let keys: unknown[] = []
  return vi.fn((url: string, init?: RequestInit) => {
    const route = key(url, init)
    if (overrides[route]) return Promise.resolve(overrides[route](init))
    if (route === 'GET /api/v1/users/me/ai-permissions')
      return Promise.resolve(jsonResponse({ catalog, allowed: ['read'] }))
    if (route === 'GET /api/v1/users/me/mcp-keys')
      return Promise.resolve(jsonResponse({ keys }))
    if (route === 'POST /api/v1/users/me/mcp-keys') {
      keys = [keyRow]
      return Promise.resolve(
        jsonResponse(
          { key: keyRow, secret: 'dkd_THESECRETVALUE1234567890abcdefghijklmn' },
          201
        )
      )
    }
    if (route === `DELETE /api/v1/users/me/mcp-keys/${keyRow.id}`) {
      keys = [{ ...keyRow, revokedAt: '2026-10-11T11:00:00Z' }]
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    if (route === 'GET /api/v1/users/me/mcp-audit')
      return Promise.resolve(
        jsonResponse({
          entries: [
            {
              at: '2026-10-11T10:05:00Z',
              keyId: keyRow.id,
              keyName: 'Laptop',
              userId: 'u',
              tool: 'read_document',
              resource: 'document:abc',
              outcome: 'ok',
              detail: '',
            },
          ],
        })
      )
    return Promise.resolve(jsonResponse({ title: 'not found' }, 404))
  })
}

function mount() {
  useAuthStore.getState().auth.setSession(testSession())
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AIAccessPage />
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

it('saves the AI permissions the User ticks', async () => {
  const fetch = api({
    'PUT /api/v1/users/me/ai-permissions': (init) =>
      jsonResponse({
        catalog,
        allowed: JSON.parse(String(init?.body)).allowed,
      }),
  })
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()
  await expect
    .element(screen.getByRole('checkbox', { name: /Read/ }))
    .toBeChecked()
  await expect
    .element(screen.getByRole('checkbox', { name: /Document content/ }))
    .not.toBeChecked()
  await userEvent.click(
    screen.getByRole('checkbox', { name: /Document content/ })
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Save AI permissions' })
  )
  await expect.element(screen.getByText('AI permissions saved.')).toBeVisible()
  const [, init] = fetch.mock.calls.find(
    ([url, i]) => key(url, i) === 'PUT /api/v1/users/me/ai-permissions'
  )!
  expect(JSON.parse(String(init?.body))).toEqual({
    allowed: ['read', 'content'],
  })
})

it('shows a new key once, then only its prefix, and revokes it', async () => {
  vi.stubGlobal('fetch', api())
  const screen = await mount()
  await expect.element(screen.getByText('No keys yet.')).toBeVisible()
  await userEvent.fill(
    screen.getByRole('textbox', { name: 'Key name' }),
    'Laptop'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Create key' }))
  await expect
    .element(screen.getByText('dkd_THESECRETVALUE1234567890abcdefghijklmn'))
    .toBeVisible()
  await expect
    .element(screen.getByText(/will not be shown again/))
    .toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'I saved it' }))
  expect(
    screen.getByText('dkd_THESECRETVALUE1234567890abcdefghijklmn').elements()
  ).toHaveLength(0)
  await expect.element(screen.getByText('dkd_abcdefgh…')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Revoke Laptop' }))
  await userEvent.click(screen.getByRole('button', { name: 'Revoke key' }))
  await expect.element(screen.getByText('Revoked')).toBeVisible()
})

it('lists recent MCP calls without content', async () => {
  vi.stubGlobal('fetch', api())
  const screen = await mount()
  await expect.element(screen.getByText('read_document')).toBeVisible()
  await expect.element(screen.getByText('document:abc')).toBeVisible()
})
