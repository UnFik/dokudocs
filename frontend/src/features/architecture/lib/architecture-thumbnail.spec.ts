import { describe, expect, it } from 'vitest'
import {
  architectureThumbnail,
  MAX_THUMBNAIL_CONNECTIONS,
} from './architecture-thumbnail'
import type {
  ArchitectureConnection,
  ArchitectureJSON,
  ArchitectureNode,
} from './canvas-model'

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

const connection = (id: string, source: string, target: string) =>
  ({
    id,
    source,
    target,
    protocol: 'rest',
    label: '',
    port: null,
    links: [],
  }) satisfies ArchitectureConnection

// VPS at (100, 100) 300×200 holding API at (14, 32); a Group; Cache on its own.
const canvas: ArchitectureJSON = {
  version: 1,
  nodes: [
    node({
      id: 'vps',
      kind: 'host',
      name: '<script>alert(1)</script>',
      x: 100,
      y: 100,
      w: 300,
      h: 200,
    }),
    node({ id: 'api', x: 14, y: 32, parentId: 'vps' }),
    node({ id: 'edge', kind: 'group', x: 500, y: 100, w: 220, h: 140 }),
    node({ id: 'cache', x: 600, y: 400 }),
  ],
  connections: [connection('c1', 'api', 'cache')],
}

const parse = (svg: string) =>
  new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement

describe('the card drawing of a canvas', () => {
  it('has none for an empty canvas', () => {
    expect(
      architectureThumbnail({ version: 1, nodes: [], connections: [] })
    ).toBe('')
  })

  it('draws Hosts dashed, Groups dotted, Systems as small boxes, in theme colours', () => {
    const svg = parse(architectureThumbnail(canvas))
    expect(svg.tagName).toBe('svg')
    const kind = (k: string) => svg.querySelector(`g[data-kind="${k}"]`)!
    const host = kind('host')
    const group = kind('group')
    const systems = [...kind('system').querySelectorAll('rect')]
    expect(host.getAttribute('stroke-dasharray')).toBeTruthy()
    expect(host.getAttribute('fill')).toBe('var(--muted)')
    expect(group.getAttribute('stroke-dasharray')).toBeTruthy()
    expect(group.getAttribute('fill')).toBe('none')
    expect(systems).toHaveLength(2)
    expect(kind('system').getAttribute('fill')).toBe('var(--card)')
    // An element inside a Host sits where the canvas shows it: 100 + 14, 100 + 32.
    expect(
      systems.map((r) => [r.getAttribute('x'), r.getAttribute('y')])
    ).toContainEqual(['114', '132'])
  })

  it('joins the centres of the two Systems of a Connection with a straight line', () => {
    const line = parse(architectureThumbnail(canvas)).querySelector('line')!
    // API centre (180, 157), Cache centre (666, 425).
    expect([
      line.getAttribute('x1'),
      line.getAttribute('y1'),
      line.getAttribute('x2'),
      line.getAttribute('y2'),
    ]).toEqual(['180', '157', '666', '425'])
  })

  it('frames every element with some room, keeping the shape whatever the card size', () => {
    const svg = parse(architectureThumbnail(canvas))
    const [x, y, w, h] = svg.getAttribute('viewBox')!.split(' ').map(Number)
    // Elements span (100, 100) to (732, 450).
    expect(x).toBeLessThan(100)
    expect(y).toBeLessThan(100)
    expect(x! + w!).toBeGreaterThan(732)
    expect(y! + h!).toBeGreaterThan(450)
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet')
  })

  it('carries no text from the canvas', () => {
    const svg = architectureThumbnail(canvas)
    expect(svg).not.toContain('script')
    expect(parse(svg).querySelectorAll('text')).toHaveLength(0)
  })

  it('leaves Connections out when there are too many, and stays small at the element limit', () => {
    const nodes = Array.from({ length: 500 }, (_, i) =>
      node({ id: `n${i}`, x: (i % 25) * 160, y: Math.floor(i / 25) * 80 })
    )
    const many = (count: number): ArchitectureJSON => ({
      version: 1,
      nodes,
      connections: Array.from({ length: count }, (_, i) =>
        connection(`c${i}`, `n${i % 500}`, `n${(i * 7 + 1) % 500}`)
      ),
    })
    expect(
      parse(
        architectureThumbnail(many(MAX_THUMBNAIL_CONNECTIONS - 1))
      ).querySelectorAll('line')
    ).toHaveLength(MAX_THUMBNAIL_CONNECTIONS - 1)
    const full = architectureThumbnail(many(1000))
    expect(parse(full).querySelectorAll('line')).toHaveLength(0)
    expect(new TextEncoder().encode(full).length).toBeLessThan(64 * 1024)
  })
})
