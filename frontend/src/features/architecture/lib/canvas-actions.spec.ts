import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  addFromPalette,
  containerAt,
  dropElement,
  fitElement,
  resizeElement,
  takeOutElement,
} from './canvas-actions'
import { toLayoutNodes } from './canvas-actions'
import { addContainer, addSystem, readCanvas } from './canvas-doc'
import { absoluteRect } from './layout'

function vpsCanvas() {
  const doc = new Y.Doc()
  const vps = addContainer(doc, {
    kind: 'host',
    catalog: 'vps',
    name: 'VPS-1',
    x: 100,
    y: 100,
    w: 320,
    h: 206,
    parentId: null,
  })
  return { doc, vps }
}

describe('finding the container under the pointer', () => {
  it('is the innermost container holding the point, never the dragged element or what is inside it', () => {
    const { doc, vps } = vpsCanvas()
    const inner = addContainer(doc, {
      kind: 'group',
      catalog: null,
      name: 'Workers',
      x: 14,
      y: 32,
      w: 220,
      h: 140,
      parentId: vps,
    })
    const canvas = readCanvas(doc)
    expect(containerAt(canvas, { x: 150, y: 150 })).toBe(inner)
    expect(containerAt(canvas, { x: 400, y: 280 })).toBe(vps)
    expect(containerAt(canvas, { x: 150, y: 150 }, inner)).toBe(vps)
    expect(containerAt(canvas, { x: 150, y: 150 }, vps)).toBeNull()
    expect(containerAt(canvas, { x: 20, y: 20 })).toBeNull()
  })
})

describe('adding from the palette', () => {
  it('puts a System dropped on a Host into the Host’s grid slot', () => {
    const { doc, vps } = vpsCanvas()
    const id = addFromPalette(
      doc,
      readCanvas(doc),
      { kind: 'system', catalog: 'golang', name: 'Go' },
      { x: 120, y: 140 }
    )
    const node = readCanvas(doc).nodes.find((n) => n.id === id)!
    expect(node).toMatchObject({ parentId: vps, x: 14, y: 32, name: 'Go' })
  })

  it('places it centred on the pointer outside every container', () => {
    const { doc } = vpsCanvas()
    const id = addFromPalette(
      doc,
      readCanvas(doc),
      { kind: 'system', catalog: 'redis', name: 'Redis' },
      { x: 700, y: 400 }
    )
    expect(readCanvas(doc).nodes.find((n) => n.id === id)).toMatchObject({
      parentId: null,
      x: 634,
      y: 375,
    })
  })

  it('grows the Host when the slot is in a new row', () => {
    const doc = new Y.Doc()
    const vps = addContainer(doc, {
      kind: 'host',
      catalog: 'vps',
      name: 'VPS',
      x: 0,
      y: 0,
      w: 308,
      h: 96,
      parentId: null,
    })
    addSystem(doc, {
      catalog: 'golang',
      name: 'A',
      x: 14,
      y: 32,
      parentId: vps,
    })
    addSystem(doc, {
      catalog: 'golang',
      name: 'B',
      x: 162,
      y: 32,
      parentId: vps,
    })
    addFromPalette(
      doc,
      readCanvas(doc),
      { kind: 'system', catalog: 'redis', name: 'C' },
      { x: 50, y: 50 }
    )
    expect(readCanvas(doc).nodes.find((n) => n.id === vps)).toMatchObject({
      w: 308,
      h: 162,
    })
  })

  it('names a second element of the same kind with a number', () => {
    const { doc } = vpsCanvas()
    addFromPalette(
      doc,
      readCanvas(doc),
      { kind: 'host', catalog: 'vps', name: 'VPS' },
      { x: 900, y: 900 }
    )
    const second = addFromPalette(
      doc,
      readCanvas(doc),
      { kind: 'host', catalog: 'vps', name: 'VPS' },
      { x: 1300, y: 900 }
    )
    expect(readCanvas(doc).nodes.find((n) => n.id === second)!.name).toBe(
      'VPS 2'
    )
  })
})

describe('dropping an element after a drag', () => {
  it('moves a top-level System into the slot of the Host it is dropped on', () => {
    const { doc, vps } = vpsCanvas()
    const api = addSystem(doc, {
      catalog: 'golang',
      name: 'API',
      x: 600,
      y: 600,
      parentId: null,
    })
    dropElement(
      doc,
      readCanvas(doc),
      api,
      { x: 130, y: 140 },
      { x: 120, y: 140 }
    )
    expect(readCanvas(doc).nodes.find((n) => n.id === api)).toMatchObject({
      parentId: vps,
      x: 14,
      y: 32,
    })
  })

  it('keeps an element inside its Host, clamped to the padding, and grows the Host', () => {
    const { doc, vps } = vpsCanvas()
    const api = addSystem(doc, {
      catalog: 'golang',
      name: 'API',
      x: 14,
      y: 32,
      parentId: vps,
    })
    dropElement(doc, readCanvas(doc), api, { x: -50, y: 300 }, { x: 0, y: 0 })
    const canvas = readCanvas(doc)
    expect(canvas.nodes.find((n) => n.id === api)).toMatchObject({
      parentId: vps,
      x: 14,
      y: 300,
    })
    expect(canvas.nodes.find((n) => n.id === vps)!.h).toBe(364)
  })
})

describe('container actions', () => {
  it('takes an element out of its Host', () => {
    const { doc } = vpsCanvas()
    const api = addSystem(doc, {
      catalog: 'golang',
      name: 'API',
      x: 14,
      y: 32,
      parentId: readCanvas(doc).nodes[0]!.id,
    })
    takeOutElement(doc, readCanvas(doc), api)
    expect(readCanvas(doc).nodes.find((n) => n.id === api)).toMatchObject({
      parentId: null,
      x: 444,
      y: 100,
    })
  })

  it('fits a Host to its contents', () => {
    const { doc, vps } = vpsCanvas()
    addSystem(doc, {
      catalog: 'golang',
      name: 'API',
      x: 14,
      y: 32,
      parentId: vps,
    })
    fitElement(doc, readCanvas(doc), vps)
    expect(readCanvas(doc).nodes.find((n) => n.id === vps)).toMatchObject({
      w: 160,
      h: 96,
    })
  })

  it('resizes from the left without moving what is inside on screen', () => {
    const { doc, vps } = vpsCanvas()
    const api = addSystem(doc, {
      catalog: 'golang',
      name: 'API',
      x: 114,
      y: 32,
      parentId: vps,
    })
    const before = absoluteRect(toLayoutNodes(readCanvas(doc)), api)
    resizeElement(doc, readCanvas(doc), vps, { x: 50, y: 100, w: 370, h: 206 })
    const canvas = readCanvas(doc)
    expect(canvas.nodes.find((n) => n.id === vps)).toMatchObject({
      x: 50,
      w: 370,
    })
    expect(absoluteRect(toLayoutNodes(canvas), api)).toEqual(before)
  })
})
