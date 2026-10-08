import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import * as Y from 'yjs'
import { addSystem, readCanvas } from '../lib/canvas-doc'
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
          documentID='d'
          canComment
          onCommentsChanged={vi.fn()}
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
