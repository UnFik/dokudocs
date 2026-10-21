import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import * as Y from 'yjs'
import {
  addConnection,
  addContainer,
  addSystem,
  readCanvas,
  updateNode,
} from '../lib/canvas-doc'
import { PropertiesPanel } from './properties-panel'

describe('the properties panel with several elements selected', () => {
  it('says how many are selected and deletes them together', async () => {
    const doc = new Y.Doc()
    const a = addSystem(doc, {
      catalog: 'redis',
      name: 'Cache',
      x: 0,
      y: 0,
      parentId: null,
    })
    const b = addSystem(doc, {
      catalog: 'postgresql',
      name: 'DB',
      x: 0,
      y: 100,
      parentId: null,
    })
    const onDelete = vi.fn()
    const selection = [
      { kind: 'node' as const, id: a },
      { kind: 'node' as const, id: b },
    ]
    await render(
      <QueryClientProvider client={new QueryClient()}>
        <PropertiesPanel
          doc={doc}
          canvas={readCanvas(doc)}
          catalog={[]}
          selection={selection}
          canEdit
          onSelect={vi.fn()}
          onDelete={onDelete}
          onGesture={vi.fn()}
        />
      </QueryClientProvider>
    )
    await expect.element(page.getByText('2 elements selected')).toBeVisible()
    await userEvent.click(
      page.getByRole('button', { name: 'Delete 2 elements' })
    )
    expect(onDelete).toHaveBeenCalledWith(selection)
  })
})

function mountHost() {
  const doc = new Y.Doc()
  const host = addContainer(doc, {
    kind: 'host',
    catalog: 'vps',
    name: 'Docker host',
    x: 0,
    y: 0,
    w: 320,
    h: 206,
    parentId: null,
  })
  addSystem(doc, {
    catalog: 'golang',
    name: 'API',
    x: 14,
    y: 32,
    parentId: host,
  })
  const mount = (canEdit = true) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PropertiesPanel
          doc={doc}
          canvas={readCanvas(doc)}
          catalog={[]}
          selection={[{ kind: 'node', id: host }]}
          canEdit={canEdit}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onGesture={vi.fn()}
        />
      </QueryClientProvider>
    )
  return { doc, host, mount }
}

describe('the properties panel for a Host', () => {
  it('holds the fields and Delete, with no helper text, fit button or comments', async () => {
    const { mount } = mountHost()
    await mount()
    await expect.element(page.getByLabelText('name')).toHaveValue('Docker host')
    await expect.element(page.getByLabelText('Width')).toHaveValue(320)
    await expect
      .element(page.getByRole('button', { name: 'Delete host' }))
      .toBeVisible()
    for (const gone of [
      /Not smaller than/,
      /Holds \d/,
      /Documents are linked/,
      /Nothing inside to fit/,
      /comments/i,
    ])
      await expect.element(page.getByText(gone)).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Fit to contents' }))
      .not.toBeInTheDocument()
  })

  it('says why a size was refused only when a size is refused', async () => {
    const { mount } = mountHost()
    await mount()
    await page.getByLabelText('Width').fill('40')
    await expect.element(page.getByText(/Not smaller than/)).toBeVisible()
  })
})

describe('the properties panel for a System with a repository', () => {
  function mountSystem(repoUrl: string | null, canEdit: boolean) {
    const doc = new Y.Doc()
    const api = addSystem(doc, {
      catalog: 'golang',
      name: 'API',
      x: 0,
      y: 0,
      parentId: null,
    })
    updateNode(doc, api, { repoUrl })
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <PropertiesPanel
          doc={doc}
          canvas={readCanvas(doc)}
          catalog={[]}
          selection={[{ kind: 'node', id: api }]}
          canEdit={canEdit}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onGesture={vi.fn()}
        />
      </QueryClientProvider>
    )
  }
  const jump = () =>
    page.getByRole('button', { name: 'Open the repository of API' })

  it('offers the jump beside the address, to someone who may edit and to a viewer', async () => {
    for (const canEdit of [true, false]) {
      const view = await mountSystem('https://github.com/acme/api', canEdit)
      await expect.element(jump()).toBeVisible()
      await view.unmount()
    }
  })

  it('confirms before opening the address in a new tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await mountSystem('https://github.com/acme/api', false)
    await jump().click()
    expect(open).not.toHaveBeenCalled()
    await page.getByRole('button', { name: 'Open repository' }).click()
    expect(open).toHaveBeenCalledWith(
      'https://github.com/acme/api',
      '_blank',
      'noopener,noreferrer'
    )
    open.mockRestore()
  })

  it('has no jump while the address is empty or not a web address', async () => {
    for (const url of [null, 'javascript:alert(1)']) {
      const view = await mountSystem(url, true)
      await expect.element(jump()).not.toBeInTheDocument()
      await view.unmount()
    }
  })
})

function mountSystem(selected: 'api' | 'db' = 'api') {
  const doc = new Y.Doc()
  const host = addContainer(doc, {
    kind: 'host',
    catalog: 'vps',
    name: 'Docker host',
    x: 0,
    y: 0,
    w: 320,
    h: 206,
    parentId: null,
  })
  const api = addSystem(doc, {
    catalog: 'golang',
    name: 'API',
    x: 14,
    y: 32,
    parentId: host,
  })
  const db = addSystem(doc, {
    catalog: 'postgresql',
    name: 'PostgreSQL',
    x: 400,
    y: 32,
    parentId: null,
  })
  const web = addSystem(doc, {
    catalog: 'react',
    name: 'Web',
    x: 400,
    y: 200,
    parentId: null,
  })
  addConnection(doc, { source: web, target: api, protocol: 'http' })
  addConnection(doc, { source: api, target: db, protocol: 'postgresql' })
  const onSelect = vi.fn()
  const onGesture = vi.fn()
  const mount = (canEdit = true) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PropertiesPanel
          doc={doc}
          canvas={readCanvas(doc)}
          catalog={[]}
          selection={[{ kind: 'node', id: selected === 'api' ? api : db }]}
          canEdit={canEdit}
          onSelect={onSelect}
          onDelete={vi.fn()}
          onGesture={onGesture}
        />
      </QueryClientProvider>
    )
  return { doc, api, db, web, onSelect, onGesture, mount }
}

describe('the properties panel for a System', () => {
  it('lists its Connections last, before Delete, and selects the System at the other end', async () => {
    const { db, onSelect, mount } = mountSystem()
    await mount()
    await expect.element(page.getByText('connections · 2')).toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'From Web, over http' }))
      .toBeVisible()
    await userEvent.click(
      page.getByRole('button', { name: 'To PostgreSQL, over postgresql' })
    )
    expect(onSelect).toHaveBeenCalledWith([{ kind: 'node', id: db }])
    const heading = page.getByText('connections · 2').element()
    const remove = page.getByRole('button', { name: 'Delete system' }).element()
    expect(
      heading.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('shows the name once, as the title, and renames from it', async () => {
    const { doc, api, mount } = mountSystem()
    await mount()
    const title = page.getByRole('button', { name: 'name: API' })
    await expect.element(title).toBeVisible()
    expect(
      document.querySelectorAll('label[for="architecture-name"]')
    ).toHaveLength(0)
    await userEvent.click(title)
    await userEvent.type(page.getByRole('textbox', { name: 'name' }), '2')
    expect(readCanvas(doc).nodes.find((n) => n.id === api)?.name).toBe('API2')
  })

  it('no longer holds the linked documents, they have their own tab', async () => {
    const { mount } = mountSystem()
    await mount()
    await expect.element(page.getByText(/^documents ·/)).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /Link a document/ }))
      .not.toBeInTheDocument()
  })

  it('leaves Take out to the toolbar over the System', async () => {
    const { mount } = mountSystem()
    await mount()
    await expect
      .element(page.getByRole('button', { name: /Take out/ }))
      .not.toBeInTheDocument()
  })
})
