import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import * as Y from 'yjs'
import { addContainer, addSystem, readCanvas } from '../lib/canvas-doc'
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
          workspaceID='w'
          projectID={null}
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
          workspaceID='w'
          projectID={null}
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
