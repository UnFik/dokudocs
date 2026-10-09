import { toLayoutNodes } from './canvas-actions'
import type { ArchitectureJSON } from './canvas-model'
import { absoluteRect, type Rect } from './layout'

/** One selected element: a node (Host, System, Group) or a Connection. */
export type Selected = { kind: 'node' | 'edge'; id: string }

const normalise = (r: Rect): Rect => ({
  x: Math.min(r.x, r.x + r.w),
  y: Math.min(r.y, r.y + r.h),
  w: Math.abs(r.w),
  h: Math.abs(r.h),
})

const inside = (a: Rect, box: Rect) =>
  a.x >= box.x &&
  a.y >= box.y &&
  a.x + a.w <= box.x + box.w &&
  a.y + a.h <= box.y + box.h

/**
 * The elements a selection box (canvas coordinates) takes: those lying wholly
 * inside it, without the ones whose Host or Group is taken too, since they move
 * with it. Connections are never taken by the box.
 */
export function elementsInBox(
  canvas: ArchitectureJSON,
  rect: Rect
): Selected[] {
  const box = normalise(rect)
  const layout = toLayoutNodes(canvas)
  const covered = new Set(
    canvas.nodes
      .filter((n) => inside(absoluteRect(layout, n.id), box))
      .map((n) => n.id)
  )
  const parents = new Map(canvas.nodes.map((n) => [n.id, n.parentId]))
  const ancestorCovered = (id: string) => {
    for (let p = parents.get(id); p; p = parents.get(p))
      if (covered.has(p)) return true
    return false
  }
  return canvas.nodes
    .filter((n) => covered.has(n.id) && !ancestorCovered(n.id))
    .map((n) => ({ kind: 'node', id: n.id }))
}

/** Shift+click: adds the element, or takes it out when it is already selected. */
export function toggled(selection: Selected[], item: Selected): Selected[] {
  return selection.some((s) => s.id === item.id)
    ? selection.filter((s) => s.id !== item.id)
    : [...selection, item]
}

/** Ctrl/Cmd+A: every element and Connection. */
export function everything(canvas: ArchitectureJSON): Selected[] {
  return [
    ...canvas.nodes.map((n) => ({ kind: 'node' as const, id: n.id })),
    ...canvas.connections.map((c) => ({ kind: 'edge' as const, id: c.id })),
  ]
}

/**
 * The question to ask before deleting a selection, or null when none is needed:
 * only a Host or Group with contents asks first, since its contents go with it.
 */
export function confirmationFor(
  canvas: ArchitectureJSON,
  selection: Selected[]
): { title: string } | null {
  const named = new Set(selection.map((s) => s.id))
  const parents = new Map(canvas.nodes.map((n) => [n.id, n.parentId]))
  const goesWith = (id: string) => {
    for (let p = parents.get(id); p; p = parents.get(p))
      if (named.has(p)) return true
    return false
  }
  const inside = canvas.nodes.filter(
    (n) => !named.has(n.id) && goesWith(n.id)
  ).length
  if (!inside) return null
  const plural = (n: number) => `${n} element${n === 1 ? '' : 's'}`
  if (selection.length === 1) {
    const node = canvas.nodes.find((n) => n.id === selection[0]!.id)
    return {
      title: `Delete ${node?.name || 'this container'} and the ${plural(inside)} in it?`,
    }
  }
  return {
    title: `Delete ${plural(selection.length)} and the ${plural(inside)} inside them?`,
  }
}
