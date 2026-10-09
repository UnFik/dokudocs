import { toLayoutNodes } from './canvas-actions'
import type { ArchitectureJSON } from './canvas-model'
import { absoluteRect, type Point, type Rect } from './layout'

/**
 * Where a comment thread sits: an element, and for a node the clicked point as a
 * share (0 to 1) of its box, so the pin follows moves and resizes. Threads made
 * before pins existed have no point.
 */
export type PinAnchor = {
  kind: 'element'
  elementId: string
  x?: number
  y?: number
}

const share = (value: number) =>
  Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000

export function anchorAt(
  elementID: string,
  point: Point,
  rect: Rect
): PinAnchor {
  return {
    kind: 'element',
    elementId: elementID,
    x: share((point.x - rect.x) / rect.w),
    y: share((point.y - rect.y) / rect.h),
  }
}

/** The canvas point of a pin, or null when its element is gone. */
export function pinPoint(
  canvas: ArchitectureJSON,
  anchor: PinAnchor
): Point | null {
  const layout = toLayoutNodes(canvas)
  const rectOf = (id: string) => absoluteRect(layout, id)
  if (canvas.nodes.some((n) => n.id === anchor.elementId)) {
    const r = rectOf(anchor.elementId)
    if (anchor.x === undefined || anchor.y === undefined)
      return { x: r.x + r.w, y: r.y }
    return { x: r.x + anchor.x * r.w, y: r.y + anchor.y * r.h }
  }
  const connection = canvas.connections.find((c) => c.id === anchor.elementId)
  if (!connection) return null
  const a = rectOf(connection.source)
  const b = rectOf(connection.target)
  return {
    x: (a.x + a.w / 2 + b.x + b.w / 2) / 2,
    y: (a.y + a.h / 2 + b.y + b.h / 2) / 2,
  }
}
