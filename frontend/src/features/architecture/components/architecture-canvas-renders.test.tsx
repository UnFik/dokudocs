import { useEffect, useState } from 'react'
import '@/styles/index.css'
import { countRenders } from '@/test-utils/render-counter'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import * as Y from 'yjs'
import type { Peer } from '../hooks/use-architecture-session'
import {
  addConnection,
  addSystem,
  applyPatches,
  readCanvas,
} from '../lib/canvas-doc'
import { reuseUnchanged, type ArchitectureJSON } from '../lib/canvas-model'
import { ArchitectureCanvas } from './architecture-canvas'
import { SystemNode } from './canvas-nodes'

// Stable like the editor's own: the catalog query and the selection state.
const catalog: never[] = []
const selection: never[] = []
let showPeers: (peers: Peer[]) => void = () => {}

// Reads the canvas again on every change of the state, as the session does.
function Harness({ doc }: { doc: Y.Doc }) {
  const [canvas, setCanvas] = useState<ArchitectureJSON>(() => readCanvas(doc))
  const [peers, setPeers] = useState<Peer[]>([])
  useEffect(() => {
    showPeers = setPeers
    const update = () =>
      setCanvas((current) => reuseUnchanged(current, readCanvas(doc)))
    doc.on('update', update)
    return () => doc.off('update', update)
  }, [doc])
  return (
    <div style={{ width: 900, height: 600 }}>
      <ArchitectureCanvas
        doc={doc}
        canvas={canvas}
        catalog={catalog}
        readOnly={false}
        canComment
        selection={selection}
        onSelect={vi.fn()}
        peers={peers}
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

// API calls DB; Cache stands alone.
async function show() {
  const doc = new Y.Doc()
  const system = (id: string, name: string, x: number) =>
    addSystem(doc, { id, catalog: 'golang', name, x, y: 60, parentId: null })
  system('api', 'API', 40)
  system('db', 'DB', 320)
  system('cache', 'Cache', 600)
  addConnection(doc, { source: 'api', target: 'db', protocol: 'sql' })
  await render(
    <ReactFlowProvider>
      <Harness doc={doc} />
    </ReactFlowProvider>
  )
  await vi.waitFor(() =>
    expect(document.querySelectorAll('.react-flow__edge').length).toBe(1)
  )
  await new Promise((r) => setTimeout(r, 100))
  return doc
}
const settle = () => new Promise((r) => setTimeout(r, 100))

describe('drawing again only what changed', () => {
  it('draws only the System that moved', async () => {
    const doc = await show()
    const counter = countRenders(SystemNode)
    applyPatches(doc, [{ id: 'api', x: 80, y: 60 }])
    await settle()
    expect(counter.rendered()).toEqual(['api'])
  })

  it('draws no System again when someone else moves their pointer', async () => {
    await show()
    const ana = (x: number): Peer => ({
      clientID: 2,
      userID: 'u-ana',
      name: 'Ana',
      color: '#f00',
      selection: ['db'],
      pointer: { x, y: 10 },
    })
    showPeers([ana(10)])
    await settle()
    const counter = countRenders(SystemNode)
    showPeers([ana(60)])
    await settle()
    expect(counter.rendered()).toEqual([])
  })
})
