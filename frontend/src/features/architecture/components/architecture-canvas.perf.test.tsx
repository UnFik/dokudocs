import { useEffect, useState } from 'react'
import '@/styles/index.css'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import * as Y from 'yjs'
import {
  addConnection,
  addContainer,
  addSystem,
  readCanvas,
} from '../lib/canvas-doc'
import { reuseUnchanged, type ArchitectureJSON } from '../lib/canvas-model'
import { ArchitectureCanvas } from './architecture-canvas'

// How smooth a drag stays as the canvas grows. Runs only through `bun run
// test:perf` (production React); the numbers land in each test's meta and the
// CI job writes them as a table. It measures and never fails on the numbers.

const SIZES: [number, number][] = [
  [10, 8],
  [25, 18],
  [44, 29],
  [75, 60],
  [100, 100],
  [150, 150],
  [250, 300],
  [500, 1000],
]

// One Host for every six Systems, the Systems inside them, Connections between
// Systems picked with a fixed seed so every run draws the same canvas.
function build(nodes: number, connections: number) {
  const doc = new Y.Doc()
  const hosts = Math.max(1, Math.round(nodes / 7))
  const perHost = Math.round((nodes - hosts) / hosts)
  const columns = Math.ceil(Math.sqrt(hosts))
  const systems: string[] = []
  for (let h = 0; h < hosts; h++) {
    const host = addContainer(doc, {
      kind: 'host',
      catalog: 'vps',
      name: `Host ${h}`,
      x: (h % columns) * 520,
      y: Math.floor(h / columns) * 420,
      w: 480,
      h: 380,
      parentId: null,
    })
    for (let s = 0; s < perHost && systems.length < nodes - hosts; s++)
      systems.push(
        addSystem(doc, {
          catalog: 'golang',
          name: `System ${systems.length}`,
          x: 14 + (s % 3) * 150,
          y: 32 + Math.floor(s / 3) * 70,
          parentId: host,
        })
      )
  }
  while (systems.length < nodes - hosts)
    systems.push(
      addSystem(doc, {
        catalog: 'redis',
        name: `System ${systems.length}`,
        x: -300,
        y: systems.length * 70,
        parentId: null,
      })
    )
  let seed = 7
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let c = 0; c < connections; c++) {
    const a = Math.floor(random() * systems.length)
    let b = Math.floor(random() * systems.length)
    if (a === b) b = (a + 1) % systems.length
    addConnection(doc, {
      source: systems[a]!,
      target: systems[b]!,
      protocol: 'rest',
    })
  }
  return { doc, systems }
}

const catalog: never[] = []
const selection: never[] = []

// Reads the canvas once a frame after a change, as the session does.
function Harness({ doc }: { doc: Y.Doc }) {
  const [canvas, setCanvas] = useState<ArchitectureJSON>(() => readCanvas(doc))
  useEffect(() => {
    let frame = 0
    const publish = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() =>
        setCanvas((current) => reuseUnchanged(current, readCanvas(doc)))
      )
    }
    doc.on('update', publish)
    return () => doc.off('update', publish)
  }, [doc])
  return (
    <div style={{ width: 1400, height: 900 }}>
      <ArchitectureCanvas
        doc={doc}
        canvas={canvas}
        catalog={catalog}
        readOnly={false}
        canComment
        selection={selection}
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

const frame = () => new Promise<number>((r) => requestAnimationFrame(r))
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!

describe.skipIf(!import.meta.env.VITE_CANVAS_PERF)(
  'dragging on a growing canvas',
  () => {
    it.for(SIZES)(
      '%i elements, %i connections',
      { timeout: 300_000 },
      async ([nodes, connections], { task }) => {
        const { doc, systems } = build(nodes, connections)
        const start = performance.now()
        const screen = await render(
          <ReactFlowProvider>
            <Harness doc={doc} />
          </ReactFlowProvider>
        )
        for (let i = 0; i < 600; i++) {
          await frame()
          if (
            document.querySelectorAll('.react-flow__edge').length >=
            connections * 0.9
          )
            break
        }
        const mount = performance.now() - start

        // One System pressed and moved a little every frame, as a hand would.
        const node = document.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${systems[1]}"]`
        )!
        const box = node.getBoundingClientRect()
        const at = (dx: number, dy: number): MouseEventInit => ({
          bubbles: true,
          clientX: box.x + 30 + dx,
          clientY: box.y + 20 + dy,
          button: 0,
          buttons: 1,
          view: window,
        })
        node.dispatchEvent(new MouseEvent('mousedown', at(0, 0)))
        const frames: number[] = []
        let last = await frame()
        for (let i = 1; i <= 60; i++) {
          window.dispatchEvent(new MouseEvent('mousemove', at(i * 2, i)))
          const now = await frame()
          frames.push(now - last)
          last = now
        }
        window.dispatchEvent(new MouseEvent('mouseup', at(120, 60)))

        task.meta.canvasPerf = {
          elements: nodes,
          connections,
          mountMs: Math.round(mount),
          dragFps: Math.round(1000 / median(frames)),
          medianFrameMs: Math.round(median(frames)),
          worstFrameMs: Math.round(Math.max(...frames)),
        }
        await screen.unmount()
        doc.destroy()
      }
    )
  }
)

declare module 'vitest' {
  interface TaskMeta {
    canvasPerf?: {
      elements: number
      connections: number
      mountMs: number
      dragFps: number
      medianFrameMs: number
      worstFrameMs: number
    }
  }
}
