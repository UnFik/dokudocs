import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { useAuthStore } from '@/stores/auth-store'
import type { CatalogEntry } from '../lib/catalog'
import { CatalogPalette } from './catalog-palette'

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const entry = (slug: string, category: CatalogEntry['category'], subkind: string, name: string): CatalogEntry => ({
  slug, category, subkind, name, family: null, sortOrder: 0, deprecated: false,
})
const catalog = [entry('vps', 'host', 'compute', 'VPS'), entry('golang', 'system', 'language', 'Go'), entry('postgresql', 'system', 'database', 'PostgreSQL')]

beforeEach(() => useAuthStore.getState().auth.setSession(testSession()))
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

function mount(onAdd = vi.fn(), blocked: string | null = null) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CatalogPalette workspaceID={workspaceID} catalog={catalog} loading={false} error={false} onRetry={vi.fn()} onAdd={onAdd} blocked={blocked} warning={null} />
    </QueryClientProvider>
  )
}

describe('the catalog palette', () => {
  it('finds an entry by name and adds it with Enter', async () => {
    const onAdd = vi.fn()
    const screen = await mount(onAdd)
    await screen.getByLabelText('search the catalog').fill('postg')
    const item = screen.getByRole('button', { name: 'PostgreSQL' })
    await expect.element(item).toBeVisible()
    await item.click()
    expect(onAdd).toHaveBeenCalledWith({ kind: 'system', catalog: 'postgresql', name: 'PostgreSQL' })
  })

  it('offers a generic Service and a request when the search finds nothing', async () => {
    const onAdd = vi.fn()
    const fetch = vi.fn(async () => jsonResponse({ id: 'r1', name: 'Acme MQ', votes: 1, alreadyRequested: false }, 201))
    vi.stubGlobal('fetch', fetch)
    const screen = await mount(onAdd)
    await screen.getByLabelText('search the catalog').fill('Acme MQ')
    await expect.element(screen.getByText('No “Acme MQ” in the catalog.')).toBeVisible()

    await screen.getByRole('button', { name: 'Add “Acme MQ” as a Service' }).click()
    expect(onAdd).toHaveBeenCalledWith({ kind: 'system', catalog: 'service', name: 'Acme MQ' })

    await screen.getByRole('button', { name: 'Request “Acme MQ”' }).click()
    await screen.getByLabelText('official website (optional)').fill('https://acme.example')
    await screen.getByRole('button', { name: 'Send request' }).click()
    await expect.element(screen.getByRole('status')).toHaveTextContent('Request for “Acme MQ” sent.')
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ workspaceID, name: 'Acme MQ', category: 'system', website: 'https://acme.example', note: '' })
  })

  it('points at the entry when the requested name is already in the catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: { slug: 'postgresql', title: 'this is already in the catalog' } }, 409)))
    const screen = await mount()
    await screen.getByLabelText('search the catalog').fill('Postgres DB')
    await screen.getByRole('button', { name: 'Request “Postgres DB”' }).click()
    await screen.getByRole('button', { name: 'Send request' }).click()
    await expect.element(screen.getByRole('status')).toHaveTextContent('already in the catalog as postgresql')
  })

  it('cannot add anything while the canvas is read-only', async () => {
    const screen = await mount(vi.fn(), 'You can view this canvas but not change it.')
    await expect.element(screen.getByText('You can view this canvas but not change it.')).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'VPS' })).toBeDisabled()
  })
})
