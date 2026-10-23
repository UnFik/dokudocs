import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import * as Y from 'yjs'
import { useAuthStore } from '@/stores/auth-store'
import {
  addConnection,
  addSystem,
  readCanvas,
  updateNode,
} from '../lib/canvas-doc'
import { DocumentsPanel } from './documents-panel'

beforeEach(() => {
  useAuthStore.getState().auth.setSession(testSession())
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse([]))
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

function build() {
  const doc = new Y.Doc()
  const api = addSystem(doc, {
    catalog: 'golang',
    name: 'API',
    x: 0,
    y: 0,
    parentId: null,
  })
  const db = addSystem(doc, {
    catalog: 'postgresql',
    name: 'DB',
    x: 200,
    y: 0,
    parentId: null,
  })
  const call = addConnection(doc, {
    source: api,
    target: db,
    protocol: 'postgresql',
  })
  return { doc, api, db, call }
}

const mount = (
  doc: Y.Doc,
  selection: Parameters<typeof DocumentsPanel>[0]['selection'],
  canEdit = true
) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <DocumentsPanel
        doc={doc}
        canvas={readCanvas(doc)}
        selection={selection}
        canEdit={canEdit}
        workspaceID='w'
        projectID={null}
        documentID='a'
      />
    </QueryClientProvider>
  )

describe('the Documents tab', () => {
  it('asks for a selection when there is none', async () => {
    const { doc } = build()
    await mount(doc, [])
    await expect
      .element(page.getByText(/Select a System or Connection/))
      .toBeVisible()
  })

  it('shows the documents of the selected System and offers to link one', async () => {
    const { doc, api } = build()
    await mount(doc, [{ kind: 'node', id: api }])
    await expect.element(page.getByText('documents · 0')).toBeVisible()
    await expect
      .element(page.getByRole('heading', { name: 'API' }))
      .toBeVisible()
    await expect
      .element(page.getByRole('button', { name: /Link a document/ }))
      .toBeVisible()
  })

  it('puts Link and New above the linked documents', async () => {
    const { doc, api } = build()
    updateNode(doc, api, { links: ['d1'] })
    await mount(doc, [{ kind: 'node', id: api }])
    await expect.element(page.getByText('documents · 1')).toBeVisible()
    const link = page.getByRole('button', { name: /Link a document/ }).element()
    const create = page.getByRole('button', { name: /New document/ }).element()
    const list = document.querySelector('ul')!
    for (const button of [link, create])
      expect(
        button.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
  })

  it('names a Connection by its two ends', async () => {
    const { doc, call } = build()
    await mount(doc, [{ kind: 'edge', id: call }])
    await expect
      .element(page.getByRole('heading', { name: 'API → DB' }))
      .toBeVisible()
  })

  it('offers no linking to someone who cannot edit', async () => {
    const { doc, api } = build()
    await mount(doc, [{ kind: 'node', id: api }], false)
    await expect.element(page.getByText('documents · 0')).toBeVisible()
    await expect
      .element(page.getByRole('button', { name: /Link a document/ }))
      .not.toBeInTheDocument()
  })
})
