import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { CatalogRequests } from './catalog-requests'

beforeEach(() => useAuthStore.getState().auth.setSession(testSession()))
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

const requestID = '7a1f3e5c-1111-4111-8111-111111111111'
function stub(admin: boolean) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname
    if (path === '/api/v1/notifications')
      return jsonResponse([
        {
          id: 'n1',
          kind: 'catalog_request',
          title: '“Acme MQ” is in the catalog',
          body: 'Search the palette for it.',
          read: false,
          createdAt: '2026-10-08T00:00:00Z',
        },
      ])
    if (path === '/api/v1/notifications/read')
      return new Response(null, { status: 204 })
    if (path === '/api/v1/catalog/requests/mine')
      return jsonResponse([
        {
          id: requestID,
          name: 'Acme MQ',
          status: 'added',
          resolvedSlug: 'rabbitmq',
          declineReason: '',
          votes: 2,
        },
      ])
    if (path === '/api/v1/catalog/requests')
      return admin
        ? jsonResponse([
            {
              id: requestID,
              name: 'Acme MQ',
              category: 'system',
              website: '',
              note: 'Our queue',
              votes: 2,
              createdAt: '2026-10-08T00:00:00Z',
            },
          ])
        : jsonResponse(
            { title: 'only a platform admin may review catalog requests' },
            403
          )
    if (
      path === `/api/v1/catalog/requests/${requestID}` &&
      init?.method === 'PATCH'
    )
      return new Response(null, { status: 204 })
    throw new Error(`Unexpected request: ${path}`)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const mount = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CatalogRequests
        catalog={[
          {
            slug: 'rabbitmq',
            category: 'system',
            subkind: 'broker',
            name: 'RabbitMQ',
            family: null,
            sortOrder: 1,
            deprecated: false,
          },
        ]}
      />
    </QueryClientProvider>
  )

describe('catalog requests in the palette', () => {
  it('tells a member their request was answered, and hides the review list', async () => {
    stub(false)
    const screen = await mount()
    const button = screen.getByRole('button', { name: /Your requests/ })
    await expect.element(button).toHaveTextContent('1 new')
    await button.click()
    await expect
      .element(screen.getByText('“Acme MQ” is in the catalog'))
      .toBeVisible()
    expect(screen.container.textContent).not.toContain('Review requests')
  })

  it('lets a platform admin mark a request added', async () => {
    const fetch = stub(true)
    const screen = await mount()
    await screen.getByRole('button', { name: 'Review requests (1)' }).click()
    await screen.getByLabelText('added as').selectOptions('rabbitmq')
    await screen.getByRole('button', { name: 'Mark added' }).click()
    await vi.waitFor(() => {
      const patch = fetch.mock.calls.find(
        ([, init]) => init?.method === 'PATCH'
      )
      expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
        status: 'added',
        slug: 'rabbitmq',
      })
    })
  })
})
