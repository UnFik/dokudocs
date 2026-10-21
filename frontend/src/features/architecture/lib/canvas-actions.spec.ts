import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  addFromPalette,
  containerAt,
  dropElement,
  fitElement,
  planDrop,
  resizeElement,
  takeOutElement,
  toLayoutNodes,
} from './canvas-actions'
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
  const api = (doc: Y.Doc, parentId: string | null, x = 600, y = 600) =>
    addSystem(doc, { catalog: 'golang', name: 'API', x, y, parentId })
  const node = (doc: Y.Doc, id: string) =>
    readCanvas(doc).nodes.find((n) => n.id === id)!

  it('moves a top-level System into the Host its centre is over', () => {
    const { doc, vps } = vpsCanvas()
    const id = api(doc, null)
    // 132×50 at (60, 120): the centre (126, 145) is inside the Host at (100,100) 320×206, the left edge is not.
    dropElement(doc, readCanvas(doc), id, { x: 60, y: 120 })
    expect(node(doc, id)).toMatchObject({ parentId: vps, x: 14, y: 32 })
  })

  it('leaves a System out when only its edge overlaps the Host', () => {
    const { doc } = vpsCanvas()
    const id = api(doc, null)
    // The box spans x -20..112 and only its right end reaches the Host (x 100..420); its centre (46) does not.
    dropElement(doc, readCanvas(doc), id, { x: -20, y: 120 })
    expect(node(doc, id)).toMatchObject({ parentId: null, x: -20, y: 120 })
  })

  it('keeps an element inside its Host while its centre is inside, clamped to the padding, and grows the Host', () => {
    const { doc, vps } = vpsCanvas()
    const id = api(doc, vps, 14, 32)
    dropElement(doc, readCanvas(doc), id, { x: -50, y: 150 })
    // The centre (-50+66, 150+25) = (16, 175) is still inside the Host (x 0..320, y 0..206 relative).
    expect(node(doc, id)).toMatchObject({ parentId: vps, x: 14, y: 150 })
    dropElement(doc, readCanvas(doc), id, { x: 200, y: 180 })
    expect(node(doc, vps).h).toBeGreaterThan(206)
  })

  it('lets an element leave its Host when its centre goes outside', () => {
    const { doc, vps } = vpsCanvas()
    const id = api(doc, vps, 14, 32)
    // Relative to the Host at (100,100): (-90, 40) is abs (10, 140), centre (76, 165), left of the Host.
    dropElement(doc, readCanvas(doc), id, { x: -90, y: 40 })
    expect(node(doc, id)).toMatchObject({ parentId: null, x: 10, y: 140 })
    expect(node(doc, vps)).toMatchObject({ x: 100, y: 100, w: 320, h: 206 })
  })

  it('moves an element straight into another Host when it leaves one over the other', () => {
    const { doc, vps } = vpsCanvas()
    const other = addContainer(doc, {
      kind: 'host',
      catalog: 'vps',
      name: 'VPS-2',
      x: 500,
      y: 100,
      w: 320,
      h: 206,
      parentId: null,
    })
    const id = api(doc, vps, 14, 32)
    // Relative (440, 40) is abs (540, 140): centre (606, 165), inside VPS-2.
    dropElement(doc, readCanvas(doc), id, { x: 440, y: 40 })
    expect(node(doc, id)).toMatchObject({ parentId: other, x: 14, y: 32 })
  })
})

describe('dropping across nested containers', () => {
  // A Host at (100,100) 400×400 holding a Group at (14,32) 220×140, so abs (114,132)..(334,272).
  function nested() {
    const doc = new Y.Doc()
    const host = addContainer(doc, {
      kind: 'host',
      catalog: 'vps',
      name: 'VPS-1',
      x: 100,
      y: 100,
      w: 400,
      h: 400,
      parentId: null,
    })
    const group = addContainer(doc, {
      kind: 'group',
      catalog: null,
      name: 'Workers',
      x: 14,
      y: 32,
      w: 220,
      h: 140,
      parentId: host,
    })
    const node = (id: string) => readCanvas(doc).nodes.find((n) => n.id === id)!
    return { doc, host, group, node }
  }

  it('moves a System from the Host into the Group inside it when its centre is over the Group', () => {
    const { doc, host, group, node } = nested()
    const api = addSystem(doc, {
      catalog: 'golang',
      name: 'API',
      x: 250,
      y: 200,
      parentId: host,
    })
    // Relative to the Host (40, 60) is abs (140, 160): centre (206, 185), inside the Group.
    expect(planDrop(readCanvas(doc), api, { x: 40, y: 60 })).toMatchObject({
      stays: false,
      container: group,
      leaves: null,
    })
    dropElement(doc, readCanvas(doc), api, { x: 40, y: 60 })
    expect(node(api)).toMatchObject({ parentId: group, x: 14, y: 32 })
  })

  it('moves a System from the Group back to the Host when its centre is over the Host only', () => {
    const { doc, host, group, node } = nested()
    const api = addSystem(doc, {
      catalog: 'golang',
      name: 'API',
      x: 14,
      y: 32,
      parentId: group,
    })
    // Relative to the Group (220, 143) is abs (334, 275): centre (400, 300), inside the Host, outside the Group.
    expect(planDrop(readCanvas(doc), api, { x: 220, y: 143 })).toMatchObject({
      stays: false,
      container: host,
      leaves: group,
    })
    dropElement(doc, readCanvas(doc), api, { x: 220, y: 143 })
    expect(node(api).parentId).toBe(host)
  })

  it('keeps a System in the Group while its centre is inside it', () => {
    const { doc, group, node } = nested()
    const api = addSystem(doc, {
      catalog: 'golang',
      name: 'API',
      x: 14,
      y: 32,
      parentId: group,
    })
    expect(planDrop(readCanvas(doc), api, { x: 40, y: 50 })).toMatchObject({
      stays: true,
      container: group,
    })
    dropElement(doc, readCanvas(doc), api, { x: 40, y: 50 })
    expect(node(api)).toMatchObject({ parentId: group, x: 40, y: 50 })
  })
})

describe('where a drag would land, before it is dropped', () => {
  it('says whether the element leaves, and which container it would enter', () => {
    const { doc, vps } = vpsCanvas()
    const id = addSystem(doc, {
      catalog: 'golang',
      name: 'API',
      x: 14,
      y: 32,
      parentId: vps,
    })
    const canvas = readCanvas(doc)
    expect(planDrop(canvas, id, { x: 20, y: 40 })).toMatchObject({
      stays: true,
      container: vps,
      leaves: null,
    })
    expect(planDrop(canvas, id, { x: -90, y: 40 })).toMatchObject({
      stays: false,
      container: null,
      leaves: vps,
    })
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
