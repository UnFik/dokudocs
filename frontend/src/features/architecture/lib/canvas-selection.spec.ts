import { describe, expect, it } from 'vitest'
import type { ArchitectureJSON, ArchitectureNode } from './canvas-model'
import {
  confirmationFor,
  elementsInBox,
  everything,
  toggled,
} from './canvas-selection'

const node = (fields: Partial<ArchitectureNode> & { id: string }) =>
  ({
    kind: 'system',
    name: fields.id,
    catalog: null,
    x: 0,
    y: 0,
    w: null,
    h: null,
    parentId: null,
    tags: [],
    description: '',
    repoUrl: null,
    links: [],
    ...fields,
  }) satisfies ArchitectureNode

// VPS at (100, 100) 320×206 holding API at (14, 32); Cache alone at (600, 100).
const canvas: ArchitectureJSON = {
  version: 1,
  nodes: [
    node({ id: 'vps', kind: 'host', x: 100, y: 100, w: 320, h: 206 }),
    node({ id: 'api', x: 14, y: 32, parentId: 'vps' }),
    node({ id: 'cache', x: 600, y: 100 }),
  ],
  connections: [
    {
      id: 'c1',
      source: 'api',
      target: 'cache',
      protocol: 'redis',
      label: '',
      port: null,
      links: [],
    },
  ],
}

const ids = (selection: { id: string }[]) => selection.map((s) => s.id).sort()

describe('the selection box', () => {
  it('takes only elements that lie completely inside it', () => {
    // Covers Cache whole and only half of the VPS.
    expect(
      ids(elementsInBox(canvas, { x: 300, y: 50, w: 500, h: 200 }))
    ).toEqual(['cache'])
  })

  it('takes a Host and not what is inside it, since its contents move with it', () => {
    expect(
      ids(elementsInBox(canvas, { x: 50, y: 50, w: 800, h: 400 }))
    ).toEqual(['cache', 'vps'])
  })

  it('takes an element inside a Host when the Host itself is not covered', () => {
    // API sits at (114, 132) to (246, 182) on the canvas.
    expect(
      ids(elementsInBox(canvas, { x: 110, y: 128, w: 140, h: 60 }))
    ).toEqual(['api'])
  })

  it('never takes Connections', () => {
    expect(
      elementsInBox(canvas, { x: 0, y: 0, w: 2000, h: 2000 }).every(
        (s) => s.kind === 'node'
      )
    ).toBe(true)
  })

  it('works whichever way the box was drawn', () => {
    expect(
      ids(elementsInBox(canvas, { x: 800, y: 250, w: -300, h: -200 }))
    ).toEqual(['cache'])
  })
})

describe('Shift+click and select all', () => {
  it('adds an element that is not selected and removes one that is', () => {
    const one = toggled([], { kind: 'node', id: 'cache' })
    expect(one).toEqual([{ kind: 'node', id: 'cache' }])
    const two = toggled(one, { kind: 'edge', id: 'c1' })
    expect(two).toEqual([
      { kind: 'node', id: 'cache' },
      { kind: 'edge', id: 'c1' },
    ])
    expect(toggled(two, { kind: 'node', id: 'cache' })).toEqual([
      { kind: 'edge', id: 'c1' },
    ])
  })

  it('selects every element and Connection', () => {
    expect(everything(canvas)).toEqual([
      { kind: 'node', id: 'vps' },
      { kind: 'node', id: 'api' },
      { kind: 'node', id: 'cache' },
      { kind: 'edge', id: 'c1' },
    ])
  })
})

describe('deleting a selection', () => {
  it('needs no confirmation when no Host or Group with contents is in it', () => {
    expect(
      confirmationFor(canvas, [
        { kind: 'node', id: 'cache' },
        { kind: 'edge', id: 'c1' },
      ])
    ).toBeNull()
    expect(confirmationFor(canvas, [{ kind: 'node', id: 'api' }])).toBeNull()
  })

  it('asks first when a Host with contents is in it, counting what goes with it', () => {
    expect(confirmationFor(canvas, [{ kind: 'node', id: 'vps' }])).toEqual({
      title: 'Delete vps and the 1 element in it?',
    })
    expect(
      confirmationFor(canvas, [
        { kind: 'node', id: 'vps' },
        { kind: 'node', id: 'cache' },
      ])
    ).toEqual({ title: 'Delete 2 elements and the 1 element inside them?' })
  })
})
