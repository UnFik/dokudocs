import { describe, expect, it } from 'vitest'
import {
  absoluteRect,
  bandFor,
  fitToContents,
  growToFit,
  minSize,
  placeInside,
  slotFor,
  takeOut,
  type LayoutNode,
} from './layout'

// A Host at (100, 100), 320 x 206, holding one System at its first cell.
const host = (over: Partial<LayoutNode> = {}): LayoutNode => ({
  id: 'vps',
  kind: 'host',
  parentId: null,
  x: 100,
  y: 100,
  w: 320,
  h: 206,
  ...over,
})
const system = (
  id: string,
  parentId: string | null,
  x: number,
  y: number
): LayoutNode => ({
  id,
  kind: 'system',
  parentId,
  x,
  y,
  w: null,
  h: null,
})

describe('the slot a System lands in when it first enters a Host', () => {
  it('is the first cell of an empty Host, under its label', () => {
    expect(slotFor([host()], 'vps', { x: 120, y: 140 })).toEqual({
      x: 114,
      y: 132,
      w: 132,
      h: 50,
    })
  })

  it('is the free cell nearest the pointer', () => {
    const nodes = [host(), system('api', 'vps', 14, 32)]
    // Pointer over the right half of the first row: the second cell.
    expect(slotFor(nodes, 'vps', { x: 330, y: 150 })).toEqual({
      x: 262,
      y: 132,
      w: 132,
      h: 50,
    })
    // Pointer over the occupied first cell: the nearest free one, the cell below it.
    expect(slotFor(nodes, 'vps', { x: 160, y: 150 })).toEqual({
      x: 114,
      y: 198,
      w: 132,
      h: 50,
    })
  })

  it('opens a new row only when the cells inside the Host are taken', () => {
    const small = host({ h: 96 })
    const nodes = [
      small,
      system('a', 'vps', 14, 32),
      system('b', 'vps', 162, 32),
    ]
    expect(slotFor(nodes, 'vps', { x: 160, y: 150 })).toEqual({
      x: 114,
      y: 198,
      w: 132,
      h: 50,
    })
  })
})

describe('a Host or Group entering a Host', () => {
  it('goes in the band below everything already there', () => {
    const nodes = [host(), system('api', 'vps', 14, 32)]
    expect(bandFor(nodes, 'vps', { w: 200, h: 130 })).toEqual({
      x: 114,
      y: 198,
      w: 200,
      h: 130,
    })
  })

  it('goes under the label of an empty Host', () => {
    expect(bandFor([host()], 'vps', { w: 200, h: 130 })).toEqual({
      x: 114,
      y: 132,
      w: 200,
      h: 130,
    })
  })
})

describe('placing an element inside a Host', () => {
  it('gives it a position relative to the Host and its parent', () => {
    const nodes = [host(), system('api', null, 0, 0)]
    expect(placeInside(nodes, 'api', 'vps', { x: 262, y: 132 })).toEqual([
      { id: 'api', parentId: 'vps', x: 162, y: 32 },
    ])
  })
})

describe('growing a Host to fit what is inside it', () => {
  it('grows right and down to hold a child pushed past the edge, with padding', () => {
    const nodes = [host(), system('api', 'vps', 250, 180)]
    expect(growToFit(nodes, 'vps')).toEqual([
      { id: 'vps', x: 100, y: 100, w: 396, h: 244 },
    ])
  })

  it('grows the Host around it too', () => {
    const outer = host({ id: 'cluster', x: 0, y: 0, w: 400, h: 300 })
    const inner = host({
      id: 'vps',
      parentId: 'cluster',
      x: 14,
      y: 32,
      w: 320,
      h: 206,
    })
    const nodes = [outer, inner, system('api', 'vps', 300, 30)]
    const patches = growToFit(nodes, 'vps')
    expect(patches).toContainEqual({ id: 'vps', x: 14, y: 32, w: 446, h: 206 })
    expect(patches).toContainEqual({
      id: 'cluster',
      x: 0,
      y: 0,
      w: 474,
      h: 300,
    })
  })

  it('never shrinks', () => {
    expect(growToFit([host(), system('api', 'vps', 14, 32)], 'vps')).toEqual([])
  })
})

describe('fit to contents', () => {
  it('shrinks to the box around the children and keeps them where they are on screen', () => {
    const nodes = [host({ w: 600, h: 400 }), system('api', 'vps', 60, 80)]
    const patches = fitToContents(nodes, 'vps')
    expect(patches).toContainEqual({ id: 'vps', x: 146, y: 148, w: 160, h: 96 })
    expect(patches).toContainEqual({ id: 'api', x: 14, y: 32 })
    const after = applyAll(nodes, patches)
    expect(absoluteRect(after, 'api')).toEqual(absoluteRect(nodes, 'api'))
  })

  it('does nothing for an empty Host', () => {
    expect(fitToContents([host()], 'vps')).toEqual([])
  })
})

describe('resizing by hand', () => {
  it('stops at the box the contents need', () => {
    expect(minSize([host(), system('api', 'vps', 162, 32)], 'vps')).toEqual({
      w: 308,
      h: 96,
    })
  })

  it('stops at 160 x 90 when empty', () => {
    expect(minSize([host()], 'vps')).toEqual({ w: 160, h: 90 })
  })
})

describe('taking an element out of its Host', () => {
  it('puts it to the right of the Host at the top level, clear of other elements', () => {
    const nodes = [
      host(),
      system('api', 'vps', 14, 32),
      system('db', null, 444, 100),
    ]
    const patches = takeOut(nodes, 'api')
    expect(patches).toEqual([{ id: 'api', parentId: null, x: 444, y: 166 }])
  })

  it('moves it into the next free cell of the Host one level up', () => {
    const outer = host({ id: 'cluster', x: 0, y: 0, w: 800, h: 400 })
    const inner = host({
      id: 'vps',
      parentId: 'cluster',
      x: 14,
      y: 32,
      w: 320,
      h: 206,
    })
    const nodes = [outer, inner, system('api', 'vps', 14, 32)]
    expect(takeOut(nodes, 'api')).toEqual([
      { id: 'api', parentId: 'cluster', x: 458, y: 32 },
    ])
  })

  it('does nothing for an element at the top level', () => {
    expect(takeOut([system('api', null, 0, 0)], 'api')).toEqual([])
  })
})

function applyAll(nodes: LayoutNode[], patches: Partial<LayoutNode>[]) {
  return nodes.map((n) => {
    const patch = patches.find((p) => p.id === n.id)
    return patch ? { ...n, ...patch } : n
  })
}
