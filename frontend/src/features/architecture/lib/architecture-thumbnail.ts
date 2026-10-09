import type { ArchitectureJSON, ArchitectureNode } from './canvas-model'
import { NEW_HOST, SYSTEM_H, SYSTEM_W } from './layout'

// The drawing on a document card. `collab/` makes it on every store of an
// architecture room, so this file imports nothing but the model types and the
// layout sizes, which `collab/` copies alongside it.

/** Above this many Connections the drawing shows only the boxes, so it stays small. */
export const MAX_THUMBNAIL_CONNECTIONS = 300

const PADDING = 24

type Box = { x: number; y: number; w: number; h: number }

function boxes(canvas: ArchitectureJSON) {
  const byID = new Map(canvas.nodes.map((n) => [n.id, n]))
  const result = new Map<string, Box>()
  const boxOf = (node: ArchitectureNode): Box => {
    const known = result.get(node.id)
    if (known) return known
    const parent = node.parentId ? byID.get(node.parentId) : undefined
    const origin = parent ? boxOf(parent) : { x: 0, y: 0 }
    const box =
      node.kind === 'system'
        ? {
            x: origin.x + node.x,
            y: origin.y + node.y,
            w: SYSTEM_W,
            h: SYSTEM_H,
          }
        : {
            x: origin.x + node.x,
            y: origin.y + node.y,
            w: node.w ?? NEW_HOST.w,
            h: node.h ?? NEW_HOST.h,
          }
    result.set(node.id, box)
    return box
  }
  canvas.nodes.forEach(boxOf)
  return result
}

const round = (n: number) => Math.round(n)

// The drawing is shrunk a lot on a card; lines keep their width and dashes on
// screen instead of thinning out with it. (Not inherited, so it goes on each shape.)
const thin = 'vector-effect="non-scaling-stroke"'

// One group per kind carries the look, so each box is only its place and size.
const looks: Record<ArchitectureNode['kind'], string> = {
  host: 'fill="var(--muted)" stroke="var(--input)" stroke-dasharray="4 3"',
  group:
    'fill="none" stroke="var(--input)" stroke-dasharray="1 3" stroke-linecap="round"',
  system: 'fill="var(--card)" stroke="var(--input)"',
}

/**
 * An SVG of the canvas for its document card, or an empty string for an empty
 * canvas. Colours are theme variables, so one drawing serves both themes when
 * the card renders it inline. It holds no text from the canvas.
 */
export function architectureThumbnail(canvas: ArchitectureJSON): string {
  if (!canvas.nodes.length) return ''
  const at = boxes(canvas)
  const all = [...at.values()]
  const left = Math.min(...all.map((b) => b.x)) - PADDING
  const top = Math.min(...all.map((b) => b.y)) - PADDING
  const right = Math.max(...all.map((b) => b.x + b.w)) + PADDING
  const bottom = Math.max(...all.map((b) => b.y + b.h)) + PADDING

  // Drawn in layers: Hosts, then Groups (outer before inner), then the lines,
  // then the Systems on top.
  const depth = (node: ArchitectureNode) => {
    let d = 0
    for (
      let p = node.parentId;
      p;
      p = canvas.nodes.find((n) => n.id === p)?.parentId ?? null
    )
      d++
    return d
  }
  const ordered = [...canvas.nodes].sort((a, b) => depth(a) - depth(b))
  const group = (kind: ArchitectureNode['kind']) => {
    const inGroup = ordered.filter((n) => n.kind === kind)
    if (!inGroup.length) return ''
    const rects = inGroup.map((node) => {
      const b = at.get(node.id)!
      return `<rect x="${round(b.x)}" y="${round(b.y)}" width="${round(b.w)}" height="${round(b.h)}" rx="6" ${thin}/>`
    })
    return `<g data-kind="${kind}" ${looks[kind]}>${rects.join('')}</g>`
  }

  const lines =
    canvas.connections.length < MAX_THUMBNAIL_CONNECTIONS
      ? canvas.connections.flatMap((c) => {
          const a = at.get(c.source)
          const b = at.get(c.target)
          if (!a || !b) return []
          return [
            `<line x1="${round(a.x + a.w / 2)}" y1="${round(a.y + a.h / 2)}" x2="${round(b.x + b.w / 2)}" y2="${round(b.y + b.h / 2)}" ${thin}/>`,
          ]
        })
      : []

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(left)} ${round(top)} ${round(right - left)} ${round(bottom - top)}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">`,
    group('host'),
    group('group'),
    lines.length
      ? `<g stroke="var(--muted-foreground)" stroke-opacity="0.7">${lines.join('')}</g>`
      : '',
    group('system'),
    '</svg>',
  ].join('')
}
