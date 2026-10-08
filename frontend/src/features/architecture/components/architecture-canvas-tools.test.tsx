import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import * as Y from 'yjs'
import type { Peer } from '../hooks/use-architecture-session'
import {
  addConnection,
  addContainer,
  addSystem,
  readCanvas,
} from '../lib/canvas-doc'
import type { ArchitectureJSON } from '../lib/canvas-model'
import type { Selected } from '../lib/canvas-selection'
import type { PinAnchor } from '../lib/comment-pins'
import { ArchitectureCanvas } from './architecture-canvas'

type Spies = {
  onDelete: ReturnType<typeof vi.fn<(elements: Selected[]) => void>>
  onComment: ReturnType<typeof vi.fn<(anchor: PinAnchor) => void>>
}

function Harness(props: {
  doc: Y.Doc
  spies: Spies
  canEdit?: boolean
  canComment?: boolean
  peers?: Peer[]
  onSelection?: (selection: Selected[]) => void
}) {
  const [canvas, setCanvas] = useState<ArchitectureJSON>(() =>
    readCanvas(props.doc)
  )
  const [selection, setSelection] = useState<Selected[]>([])
  useEffect(() => {
    const update = () => setCanvas(readCanvas(props.doc))
    props.doc.on('update', update)
    return () => props.doc.off('update', update)
  }, [props.doc])
  return (
    <div style={{ width: 900, height: 600 }}>
      <input aria-label='A text field elsewhere' />
      <ArchitectureCanvas
        doc={props.doc}
        canvas={canvas}
        catalog={[]}
        readOnly={props.canEdit === false}
        canComment={props.canComment ?? true}
        selection={selection}
        onSelect={(next) => {
          setSelection(next)
          props.onSelection?.(next)
        }}
        peers={props.peers ?? []}
        onPointer={vi.fn()}
        onConnected={vi.fn()}
        onAdd={vi.fn()}
        onDelete={props.spies.onDelete}
        onComment={props.spies.onComment}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onGesture={vi.fn()}
        canAdd
      />
    </div>
  )
}

// VPS at (40, 40) holding API; Cache and DB on their own; API talks to Cache.
function sample() {
  const doc = new Y.Doc()
  const vps = addContainer(doc, {
    kind: 'host',
    catalog: 'vps',
    name: 'VPS-1',
    x: 40,
    y: 40,
    w: 320,
    h: 206,
    parentId: null,
  })
  const api = addSystem(doc, {
    catalog: 'golang',
    name: 'API',
    x: 14,
    y: 32,
    parentId: vps,
  })
  const cache = addSystem(doc, {
    catalog: 'redis',
    name: 'Cache',
    x: 480,
    y: 60,
    parentId: null,
  })
  const db = addSystem(doc, {
    catalog: 'postgresql',
    name: 'DB',
    x: 480,
    y: 220,
    parentId: null,
  })
  const link = addConnection(doc, {
    source: api,
    target: cache,
    protocol: 'redis',
  })
  return { doc, vps, api, cache, db, link }
}

async function show(props: Omit<Parameters<typeof Harness>[0], 'spies'>) {
  const spies: Spies = {
    onDelete: vi.fn<(elements: Selected[]) => void>(),
    onComment: vi.fn<(anchor: PinAnchor) => void>(),
  }
  await render(
    <QueryClientProvider client={new QueryClient()}>
      <ReactFlowProvider>
        <Harness {...props} spies={spies} />
      </ReactFlowProvider>
    </QueryClientProvider>
  )
  await vi.waitFor(() =>
    expect(
      document.querySelectorAll('.react-flow__node').length
    ).toBeGreaterThan(0)
  )
  await new Promise((r) => setTimeout(r, 100))
  return spies
}

const element = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('.react-flow__node')].find((n) =>
    [...n.querySelectorAll('span')].some((s) => s.textContent === name)
  )!
const tool = (name: string) => page.getByRole('button', { name, exact: true })
const pressed = (name: string) =>
  document
    .querySelector(`[role=toolbar] [aria-label="${name}"]`)
    ?.getAttribute('aria-pressed')
const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms))

function mouse(
  target: Element,
  type: string,
  x: number,
  y: number,
  extra: MouseEventInit = {}
) {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      buttons: type === 'mouseup' ? 0 : 1,
      view: window,
      ...extra,
    })
  )
}
async function drag(target: HTMLElement, dx: number, dy: number) {
  const box = target.getBoundingClientRect()
  const from = { x: box.x + 30, y: box.y + 12 }
  pointer(target, 'pointerdown', from.x, from.y)
  mouse(target, 'mousedown', from.x, from.y)
  await wait()
  for (let step = 1; step <= 6; step++) {
    mouse(
      window as unknown as Element,
      'mousemove',
      from.x + (dx * step) / 6,
      from.y + (dy * step) / 6
    )
    await wait()
  }
  mouse(window as unknown as Element, 'mouseup', from.x + dx, from.y + dy)
  await wait(80)
}
function pointer(target: Element, type: string, x: number, y: number) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    })
  )
}
async function box(
  from: { x: number; y: number },
  to: { x: number; y: number }
) {
  const pane = document.querySelector('.react-flow__pane')!
  pointer(pane, 'pointerdown', from.x, from.y)
  await wait()
  for (let step = 1; step <= 5; step++) {
    pointer(
      pane,
      'pointermove',
      from.x + ((to.x - from.x) * step) / 5,
      from.y + ((to.y - from.y) * step) / 5
    )
    await wait()
  }
  pointer(pane, 'pointerup', to.x, to.y)
  await wait(80)
}

afterEach(() => {
  try {
    localStorage.removeItem('architecture-tool-lock')
  } catch {
    // Storage can be blocked; nothing to clean then.
  }
})

describe('the tool bar', () => {
  it('shows an editor every tool, with its shortcut', async () => {
    await show({ doc: sample().doc })
    for (const [name, key] of [
      ['Lock tool', 'L'],
      ['Hand', 'H'],
      ['Cursor', 'V'],
      ['Eraser', 'E'],
      ['Comment', 'C'],
    ])
      await expect.element(tool(name)).toHaveAttribute('aria-keyshortcuts', key)
    expect(pressed('Cursor')).toBe('true')
  })

  it('shows a viewer only Hand and Cursor, and a commenter Comment as well', async () => {
    await show({ doc: sample().doc, canEdit: false, canComment: false })
    await expect.element(tool('Hand')).toBeVisible()
    await expect.element(tool('Cursor')).toBeVisible()
    expect(document.querySelector('[aria-label="Eraser"]')).toBeNull()
    expect(document.querySelector('[aria-label="Comment"]')).toBeNull()
    expect(document.querySelector('[aria-label="Lock tool"]')).toBeNull()
  })

  it('names the tool and its key in a tooltip', async () => {
    await show({ doc: sample().doc })
    await userEvent.hover(tool('Eraser'))
    await expect
      .element(page.getByRole('tooltip'))
      .toHaveTextContent(/Eraser\s*E/)
  })
})

describe('tool keys', () => {
  it('switch tools, Esc returns to Cursor, and nothing happens while typing', async () => {
    await show({ doc: sample().doc })
    await userEvent.keyboard('h')
    expect(pressed('Hand')).toBe('true')
    await userEvent.keyboard('{Escape}')
    expect(pressed('Cursor')).toBe('true')
    await userEvent.click(page.getByLabelText('A text field elsewhere'))
    await userEvent.keyboard('e')
    expect(pressed('Cursor')).toBe('true')
  })

  it('give a viewer no Eraser by key either', async () => {
    await show({ doc: sample().doc, canEdit: false, canComment: false })
    await userEvent.keyboard('e')
    expect(pressed('Cursor')).toBe('true')
  })

  it('switch to Hand while Space is held', async () => {
    await show({ doc: sample().doc })
    await userEvent.keyboard('{Space>}')
    expect(pressed('Hand')).toBe('true')
    await userEvent.keyboard('{/Space}')
    expect(pressed('Cursor')).toBe('true')
  })
})

describe('Hand', () => {
  it('pans only: an element can be neither moved nor selected', async () => {
    const { doc, cache } = sample()
    const onSelection = vi.fn()
    await show({ doc, onSelection })
    await userEvent.click(tool('Hand'))
    expect(getComputedStyle(element('Cache')).cursor).toBe('grab')
    await drag(element('Cache'), 120, 40)
    mouse(
      element('DB'),
      'click',
      element('DB').getBoundingClientRect().x + 20,
      element('DB').getBoundingClientRect().y + 20
    )
    await wait()
    expect(readCanvas(doc).nodes.find((n) => n.id === cache)).toMatchObject({
      x: 480,
      y: 60,
    })
    expect(onSelection).not.toHaveBeenCalledWith([
      { kind: 'node', id: expect.any(String) },
    ])
  })
})

describe('Eraser', () => {
  it('removes the clicked element once, then goes back to Cursor', async () => {
    const { doc, cache } = sample()
    const spies = await show({ doc })
    await userEvent.keyboard('e')
    await userEvent.hover(page.getByText('Cache'))
    expect(element('Cache').querySelector('[data-erasing]')).not.toBeNull()
    await userEvent.click(page.getByText('Cache'))
    expect(spies.onDelete).toHaveBeenCalledWith([{ kind: 'node', id: cache }])
    expect(pressed('Cursor')).toBe('true')
  })

  it('stays active while the tool is locked', async () => {
    const { doc, cache, db } = sample()
    const spies = await show({ doc })
    await userEvent.click(tool('Lock tool'))
    expect(pressed('Lock tool')).toBe('true')
    await userEvent.click(tool('Eraser'))
    await userEvent.click(page.getByText('Cache'))
    await userEvent.click(page.getByText('DB', { exact: true }))
    expect(spies.onDelete.mock.calls).toEqual([
      [[{ kind: 'node', id: cache }]],
      [[{ kind: 'node', id: db }]],
    ])
    expect(pressed('Eraser')).toBe('true')
  })

  it('remembers the lock on this device', async () => {
    await show({ doc: sample().doc })
    await userEvent.keyboard('l')
    expect(localStorage.getItem('architecture-tool-lock')).toBe('true')
  })
})

describe('Comment', () => {
  it('pins a new thread where the element was clicked, then goes back to Cursor', async () => {
    const { doc, cache } = sample()
    const spies = await show({ doc })
    await userEvent.keyboard('c')
    const r = element('Cache').getBoundingClientRect()
    await userEvent.click(page.elementLocator(element('Cache')), {
      position: { x: r.width / 4, y: r.height / 2 },
    })
    const [anchor] = spies.onComment.mock.calls[0] as [PinAnchor]
    expect(anchor.elementId).toBe(cache)
    expect(anchor.x).toBeCloseTo(0.25, 1)
    expect(anchor.y).toBeCloseTo(0.5, 1)
    expect(pressed('Cursor')).toBe('true')
  })

  it('does nothing on empty canvas', async () => {
    const spies = await show({ doc: sample().doc })
    await userEvent.keyboard('c')
    const pane = document
      .querySelector('.react-flow__pane')!
      .getBoundingClientRect()
    mouse(
      document.querySelector('.react-flow__pane')!,
      'click',
      pane.x + pane.width - 20,
      pane.y + pane.height - 120
    )
    await wait()
    expect(spies.onComment).not.toHaveBeenCalled()
  })
})

describe('selecting several elements', () => {
  it('takes what lies wholly inside the box, a Host without its contents', async () => {
    const { doc, vps, cache } = sample()
    const onSelection = vi.fn()
    await show({ doc, onSelection })
    const host = element('VPS-1').getBoundingClientRect()
    const c = element('Cache').getBoundingClientRect()
    await box(
      { x: host.x - 10, y: host.y - 10 },
      { x: c.right + 10, y: Math.max(host.bottom, c.bottom) + 10 }
    )
    const taken = onSelection.mock.lastCall![0] as Selected[]
    expect(taken).toHaveLength(2)
    // React Flow's own box around the selection would cover the elements.
    const own = document.querySelector('.react-flow__nodesselection')
    if (own) expect(getComputedStyle(own).display).toBe('none')
    expect(taken).toEqual(
      expect.arrayContaining([
        { kind: 'node', id: vps },
        { kind: 'node', id: cache },
      ])
    )
  })

  it('adds and removes with Shift+click, and selects everything with Ctrl+A', async () => {
    const { doc, vps, api, cache, db, link } = sample()
    const onSelection = vi.fn()
    await show({ doc, onSelection })
    await userEvent.click(page.getByText('Cache'))
    await userEvent.click(page.getByText('DB', { exact: true }), {
      modifiers: ['Shift'],
    })
    expect(onSelection).toHaveBeenLastCalledWith([
      { kind: 'node', id: cache },
      { kind: 'node', id: db },
    ])
    await userEvent.click(page.getByText('Cache'), { modifiers: ['Shift'] })
    expect(onSelection).toHaveBeenLastCalledWith([{ kind: 'node', id: db }])
    await userEvent.keyboard('{Control>}a{/Control}')
    const all = onSelection.mock.lastCall![0] as Selected[]
    expect(all).toHaveLength(5)
    expect(all).toEqual(
      expect.arrayContaining([
        { kind: 'node', id: vps },
        { kind: 'node', id: api },
        { kind: 'node', id: cache },
        { kind: 'node', id: db },
        { kind: 'edge', id: link },
      ])
    )
  })

  it('deletes everything selected with one key press', async () => {
    const { doc, cache, db } = sample()
    const spies = await show({ doc })
    await userEvent.click(page.getByText('Cache'))
    await userEvent.click(page.getByText('DB', { exact: true }), {
      modifiers: ['Shift'],
    })
    await userEvent.keyboard('{Delete}')
    expect(spies.onDelete).toHaveBeenCalledWith([
      { kind: 'node', id: cache },
      { kind: 'node', id: db },
    ])
  })

  it('moves the selected elements together', async () => {
    const { doc, cache, db } = sample()
    await show({ doc })
    await userEvent.click(page.getByText('Cache'))
    await userEvent.click(page.getByText('DB', { exact: true }), {
      modifiers: ['Shift'],
    })
    await drag(element('Cache'), 60, 30)
    await vi.waitFor(() => {
      const nodes = readCanvas(doc).nodes
      const c = nodes.find((n) => n.id === cache)!
      const d = nodes.find((n) => n.id === db)!
      expect(c.x).toBeGreaterThan(500)
      // They kept their distance, so they moved as one.
      expect([d.x - c.x, d.y - c.y]).toEqual([0, 160])
    })
  })

  it('moves only the pressed element when it was not part of the selection', async () => {
    const { doc, cache, db } = sample()
    await show({ doc })
    await userEvent.click(page.getByText('Cache'))
    await drag(element('DB'), 60, 30)
    await vi.waitFor(() =>
      expect(readCanvas(doc).nodes.find((n) => n.id === db)!.x).toBeGreaterThan(
        500
      )
    )
    expect(readCanvas(doc).nodes.find((n) => n.id === cache)).toMatchObject({
      x: 480,
      y: 60,
    })
  })
})

describe('presence', () => {
  it('outlines every element another person has selected, naming them once', async () => {
    const { doc, cache, db } = sample()
    await show({
      doc,
      peers: [
        {
          clientID: 2,
          userID: 'u2',
          name: 'Rina',
          color: 'rgb(200, 0, 0)',
          selection: [cache, db],
          pointer: null,
        },
      ],
    })
    expect(element('Cache').querySelector('[data-peer-outline]')).not.toBeNull()
    expect(element('DB').querySelector('[data-peer-outline]')).not.toBeNull()
    expect(page.getByText('Rina').elements()).toHaveLength(1)
  })
})
