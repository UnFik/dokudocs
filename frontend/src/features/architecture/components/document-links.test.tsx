import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import '@/styles/index.css'
import { jsonResponse } from '@/test-utils/auth'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { DocumentLinks } from './document-links'

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const runbook = '3f2a9c1e-5b7d-4e8a-9c3b-1a2b3c4d5e6f'
const secret = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'
const canvas = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'
const internals = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b'
const now = '2026-10-13T00:00:00Z'

const runbookRow = {
  id: runbook,
  workspaceId: workspaceID,
  title: 'Runbook',
  type: 'markdown',
  content: '# Runbook\n\nHow we deploy.',
  projectName: 'Platform',
  authorId: 'u1',
  author: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
  isDraft: false,
  visibility: 'workspace',
  createdAt: now,
  updatedAt: now,
}

const canvasRow = {
  ...runbookRow,
  id: canvas,
  title: 'Platform overview',
  type: 'architecture',
  content: '',
}
const internalsRow = { ...canvasRow, id: internals, title: 'Order internals' }

afterEach(() => vi.unstubAllGlobals())

async function show(links: string[], canEdit = false) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/v1/documents')
        return jsonResponse([runbookRow, canvasRow, internalsRow])
      if (url.pathname === `/api/v1/documents/${runbook}`)
        return jsonResponse(runbookRow)
      return jsonResponse({ title: 'not found' }, 404)
    })
  )
  const root = createRootRoute()
  const here = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <DocumentLinks
        workspaceID={workspaceID}
        projectID={null}
        architectureID={canvas}
        links={links}
        canEdit={canEdit}
        onChange={vi.fn()}
      />
    ),
  })
  const doc = createRoute({
    getParentRoute: () => root,
    path: '/docs/$docId',
    component: () => null,
  })
  const router = createRouter({
    routeTree: root.addChildren([here, doc]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('the documents linked to an element', () => {
  it('names each document as a link to it, with a card on hover like the one in the AI chat', async () => {
    await show([runbook])
    const link = page.getByRole('link', { name: 'Runbook' })
    await expect
      .element(link)
      .toHaveAttribute('href', expect.stringContaining(`/docs/${runbook}`))

    await userEvent.hover(link)

    await expect
      .element(page.getByRole('img', { name: 'Preview of Runbook' }))
      .toBeVisible()
    await expect.element(page.getByText('Platform')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() =>
      expect(document.querySelector('[data-card-thumbnail]')).toBeNull()
    )
  })

  it('opens the same card from the keyboard', async () => {
    await show([runbook])
    await userEvent.tab()
    await expect
      .element(page.getByRole('link', { name: 'Runbook' }))
      .toHaveFocus()
    await expect
      .element(page.getByRole('img', { name: 'Preview of Runbook' }))
      .toBeVisible()
  })

  it('offers another Architecture to link, but never the canvas itself', async () => {
    await show([], true)
    await userEvent.click(
      page.getByRole('button', { name: 'Link a document…' })
    )
    await expect
      .element(page.getByRole('option', { name: /Order internals/ }))
      .toBeVisible()
    await expect
      .element(page.getByRole('option', { name: /Runbook/ }))
      .toBeVisible()
    await expect
      .element(page.getByRole('option', { name: /Platform overview/ }))
      .not.toBeInTheDocument()
  })

  it('offers Architecture when starting a new document to link', async () => {
    await show([], true)
    await userEvent.click(page.getByRole('button', { name: 'New document…' }))
    await expect
      .element(page.getByRole('option', { name: 'Architecture' }))
      .toBeInTheDocument()
  })

  it('gives a document the person cannot open no link and no card', async () => {
    await show([secret])
    await expect
      .element(page.getByText('A document you cannot open'))
      .toBeVisible()
    await expect.element(page.getByRole('link')).not.toBeInTheDocument()
  })
})
