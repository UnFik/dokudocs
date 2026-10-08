import { describe, expect, it } from 'vitest'
import type { ArchitectureJSON, ArchitectureNode } from './canvas-model'
import { anchorAt, pinPoint } from './comment-pins'

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

// VPS at (100, 100) 300×200 holding API at (14, 32), 132×50; Cache at (600, 100).
const canvas: ArchitectureJSON = {
  version: 1,
  nodes: [
    node({ id: 'vps', kind: 'host', x: 100, y: 100, w: 300, h: 200 }),
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

describe('where a comment pin sits', () => {
  it('stores the clicked point as a share of the element box', () => {
    expect(
      anchorAt('vps', { x: 175, y: 150 }, { x: 100, y: 100, w: 300, h: 200 })
    ).toEqual({
      kind: 'element',
      elementId: 'vps',
      x: 0.25,
      y: 0.25,
    })
  })

  it('keeps the point on the element when the click lands on its edge', () => {
    expect(
      anchorAt('vps', { x: 90, y: 330 }, { x: 100, y: 100, w: 300, h: 200 })
    ).toMatchObject({
      x: 0,
      y: 1,
    })
  })

  it('follows the element when it moves or is resized', () => {
    const anchor = {
      kind: 'element' as const,
      elementId: 'vps',
      x: 0.5,
      y: 0.5,
    }
    expect(pinPoint(canvas, anchor)).toEqual({ x: 250, y: 200 })
    const moved: ArchitectureJSON = {
      ...canvas,
      nodes: canvas.nodes.map((n) =>
        n.id === 'vps' ? { ...n, x: 0, y: 0, w: 400 } : n
      ),
    }
    expect(pinPoint(moved, anchor)).toEqual({ x: 200, y: 100 })
  })

  it('places a pin inside a Host relative to the canvas', () => {
    expect(
      pinPoint(canvas, { kind: 'element', elementId: 'api', x: 0, y: 0 })
    ).toEqual({
      x: 114,
      y: 132,
    })
  })

  it('puts a thread made before pins existed at the top right corner', () => {
    expect(pinPoint(canvas, { kind: 'element', elementId: 'cache' })).toEqual({
      x: 732,
      y: 100,
    })
  })

  it('puts a pin on a Connection halfway between its two ends', () => {
    // API centre (180, 157), Cache centre (666, 125).
    expect(pinPoint(canvas, { kind: 'element', elementId: 'c1' })).toEqual({
      x: 423,
      y: 141,
    })
  })

  it('has no place for a removed element', () => {
    expect(pinPoint(canvas, { kind: 'element', elementId: 'gone' })).toBeNull()
  })
})
