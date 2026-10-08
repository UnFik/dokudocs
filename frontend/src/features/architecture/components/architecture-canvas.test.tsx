import '@/styles/index.css'
import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import * as Y from 'yjs'
import { addContainer, addSystem, readCanvas } from '../lib/canvas-doc'
import type { ArchitectureJSON } from '../lib/canvas-model'
import { ArchitectureCanvas } from './architecture-canvas'

// The canvas as the editor drives it: the Yjs state is the record and every
// change to it re-renders the canvas, as a drag does every 50 ms.
function Harness({ doc }: { doc: Y.Doc }) {
  const [canvas, setCanvas] = useState<ArchitectureJSON>(() => readCanvas(doc))
  useEffect(() => {
    const update = () => setCanvas(readCanvas(doc))
    doc.on('update', update)
    return () => doc.off('update', update)
  }, [doc])
  return (
    <div style={{ width: 900, height: 600 }}>
      <ArchitectureCanvas
        doc={doc}
        canvas={canvas}
        catalog={[]}
        readOnly={false}
        selection={[]}
        canComment
        onSelect={vi.fn()}
        peers={[]}
        onPointer={vi.fn()}
        onConnected={vi.fn()}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onGesture={vi.fn()}
        canAdd
      />
    </div>
  )
}

const hidden = () =>
  [...document.querySelectorAll<HTMLElement>('.react-flow__node')].filter(
    (n) => getComputedStyle(n).visibility === 'hidden'
  )

describe('dragging on the canvas', () => {
  it('keeps every element on screen while one is dragged', async () => {
    const doc = new Y.Doc()
    const vps = addContainer(doc, { kind: 'host', catalog: 'vps', name: 'VPS-1', x: 40, y: 40, w: 320, h: 206, parentId: null })
    addSystem(doc, { catalog: 'golang', name: 'API', x: 14, y: 32, parentId: vps })
    addSystem(doc, { catalog: 'redis', name: 'Cache', x: 500, y: 300, parentId: null })
    await render(
      <QueryClientProvider client={new QueryClient()}>
        <ReactFlowProvider>
          <Harness doc={doc} />
        </ReactFlowProvider>
      </QueryClientProvider>
    )
    await vi.waitFor(() => expect(document.querySelectorAll('.react-flow__node')).toHaveLength(3))
    await vi.waitFor(() => expect(hidden()).toEqual([]))

    const cache = [...document.querySelectorAll<HTMLElement>('.react-flow__node')].find((n) => n.textContent?.includes('Cache'))!
    const box = cache.getBoundingClientRect()
    const start = { clientX: box.x + 40, clientY: box.y + 20 }
    const fire = (type: string, x: number, y: number) =>
      cache.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons: 1, view: window }))
    fire('mousedown', start.clientX, start.clientY)
    const seen: string[] = []
    for (let step = 1; step <= 12; step++) {
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: start.clientX + step * 15, clientY: start.clientY + step * 5, buttons: 1, view: window }))
      await new Promise((r) => setTimeout(r, 60))
      seen.push(...hidden().map((n) => n.textContent ?? '?'))
    }
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: start.clientX + 180, clientY: start.clientY + 60, view: window }))
    expect(seen).toEqual([])
    await vi.waitFor(() => expect(readCanvas(doc).nodes.find((n) => n.name === 'Cache')!.x).toBeGreaterThan(560))

    // A Host carries what is inside it, and nothing disappears on the way.
    const host = [...document.querySelectorAll<HTMLElement>('.react-flow__node')].find((n) => n.textContent?.startsWith('VPS-1'))!
    const hostBox = host.getBoundingClientRect()
    const from = { x: hostBox.x + 30, y: hostBox.y + 12 }
    host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: from.x, clientY: from.y, buttons: 1, view: window }))
    const hostSeen: string[] = []
    for (let step = 1; step <= 10; step++) {
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: from.x + step * 10, clientY: from.y + step * 10, buttons: 1, view: window }))
      await new Promise((r) => setTimeout(r, 60))
      hostSeen.push(...hidden().map((n) => n.textContent ?? '?'))
    }
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: from.x + 100, clientY: from.y + 100, view: window }))
    expect(hostSeen).toEqual([])
    // Near the edge React Flow pans the view, so only check that it moved and kept its contents.
    await vi.waitFor(() => {
      const after = readCanvas(doc)
      const moved = after.nodes.find((n) => n.name === 'VPS-1')!
      expect([moved.x, moved.y]).not.toEqual([40, 40])
      expect(after.nodes.find((n) => n.name === 'API')).toMatchObject({ parentId: vps, x: 14, y: 32 })
    })
  })
})
