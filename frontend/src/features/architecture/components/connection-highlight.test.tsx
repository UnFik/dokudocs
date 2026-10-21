import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import * as Y from 'yjs'
import {
  addConnection,
  addSystem,
  readCanvas,
  updateConnection,
} from '../lib/canvas-doc'
import { ArchitectureCanvas, type Selection } from './architecture-canvas'

// Web → API → DB in a row, and Cache alone below, also reaching DB.
function build() {
  const doc = new Y.Doc()
  const system = (name: string, x: number, y: number) =>
    addSystem(doc, { catalog: 'golang', name, x, y, parentId: null })
  const web = system('Web', 40, 40)
  const api = system('API', 300, 40)
  const db = system('DB', 560, 40)
  const cache = system('Cache', 300, 240)
  const viaHttp = addConnection(doc, {
    source: web,
    target: api,
    protocol: 'http',
  })
  const viaSql = addConnection(doc, {
    source: api,
    target: db,
    protocol: 'postgresql',
  })
  const viaRedis = addConnection(doc, {
    source: cache,
    target: db,
    protocol: 'redis',
  })
  updateConnection(doc, viaHttp, { label: 'orders' })
  updateConnection(doc, viaSql, { label: 'events' })
  updateConnection(doc, viaRedis, { label: 'sessions' })
  return { doc, web, api, db, cache, viaHttp, viaSql, viaRedis }
}

async function mount(
  doc: Y.Doc,
  selection: Selection,
  onDelete: (elements: Selection) => void = vi.fn()
) {
  await render(
    <QueryClientProvider client={new QueryClient()}>
      <ReactFlowProvider>
        <div style={{ width: 900, height: 500 }}>
          <ArchitectureCanvas
            doc={doc}
            canvas={readCanvas(doc)}
            catalog={[]}
            readOnly={false}
            selection={selection}
            canComment
            onSelect={vi.fn()}
            peers={[]}
            onPointer={vi.fn()}
            onConnected={vi.fn()}
            onAdd={vi.fn()}
            onDelete={onDelete}
            onUndo={vi.fn()}
            onRedo={vi.fn()}
            onGesture={vi.fn()}
            canAdd
          />
        </div>
      </ReactFlowProvider>
    </QueryClientProvider>
  )
  await vi.waitFor(() =>
    expect(document.querySelectorAll('.react-flow__edge')).toHaveLength(3)
  )
}

const nodeBox = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('.react-flow__node')].find((n) =>
    n.textContent?.includes(name)
  )!.firstElementChild as HTMLElement
const labelOf = (text: string) =>
  [
    ...document.querySelectorAll<HTMLElement>(
      '.react-flow__edgelabel-renderer *'
    ),
  ].find((el) => el.children.length === 0 && el.textContent?.includes(text))!
const zOf = (el: Element) => getComputedStyle(el).zIndex
const edgeZ = (id: string) =>
  Number(
    zOf(
      document.querySelector(`[data-testid="rf__edge-${id}"]`)!.closest('svg')!
    )
  )

describe('selecting a System on the canvas', () => {
  it('draws its Connections and their labels above every System, and dims the rest', async () => {
    const { doc, api, viaHttp, viaSql, viaRedis } = build()
    await mount(doc, [{ kind: 'node', id: api }])

    expect(edgeZ(viaHttp)).toBeGreaterThan(10)
    expect(edgeZ(viaSql)).toBeGreaterThan(10)
    expect(edgeZ(viaRedis)).toBeLessThan(10)

    expect(Number(zOf(labelOf('orders')))).toBeGreaterThan(edgeZ(viaHttp))
    expect(Number(zOf(labelOf('events')))).toBeGreaterThan(edgeZ(viaSql))
    expect(zOf(labelOf('sessions'))).toBe('auto')
    expect(Number(getComputedStyle(labelOf('sessions')).opacity)).toBeLessThan(
      0.5
    )

    expect(Number(getComputedStyle(nodeBox('Cache')).opacity)).toBeLessThan(0.5)
    expect(Number(getComputedStyle(nodeBox('Web')).opacity)).toBe(1)
    expect(Number(getComputedStyle(nodeBox('DB')).opacity)).toBe(1)
  })

  it('leaves everything as it was when a Connection is selected', async () => {
    const { doc, viaHttp, viaRedis } = build()
    await mount(doc, [{ kind: 'edge', id: viaHttp }])
    expect(edgeZ(viaHttp)).toBeLessThan(10)
    expect(edgeZ(viaRedis)).toBeLessThan(10)
    expect(Number(getComputedStyle(labelOf('sessions')).opacity)).toBe(1)
    expect(Number(getComputedStyle(nodeBox('Cache')).opacity)).toBe(1)
  })
})

describe('the toolbar over a selected System', () => {
  it('deletes the System', async () => {
    const { doc, api } = build()
    const onDelete = vi.fn()
    await mount(doc, [{ kind: 'node', id: api }], onDelete)
    await userEvent.click(page.getByRole('button', { name: 'Delete API' }))
    expect(onDelete).toHaveBeenCalledWith([{ kind: 'node', id: api }])
  })
})
