import type * as Y from 'yjs'
import { addContainer, addSystem, applyPatches } from './canvas-doc'
import type { ArchitectureJSON } from './canvas-model'
import {
  absoluteRect,
  bandFor,
  fitToContents,
  growToFit,
  LABEL,
  NEW_GROUP,
  NEW_HOST,
  PAD,
  placeInside,
  slotFor,
  SYSTEM_H,
  SYSTEM_W,
  takeOut,
  type LayoutNode,
  type Patch,
  type Point,
  type Rect,
} from './layout'

// Gestures on the canvas, each one change to the Yjs state: what the palette,
// the canvas and the properties panel do, with the layout rules applied.

export const toLayoutNodes = (canvas: ArchitectureJSON): LayoutNode[] =>
  canvas.nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    parentId: n.parentId,
    x: n.x,
    y: n.y,
    w: n.w,
    h: n.h,
  }))

function descendants(canvas: ArchitectureJSON, id: string) {
  const ids = new Set([id])
  for (let grew = true; grew; ) {
    grew = false
    for (const n of canvas.nodes) {
      if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
        ids.add(n.id)
        grew = true
      }
    }
  }
  return ids
}

/** The innermost Host or Group under a canvas point, skipping an element being dragged and what it holds. */
export function containerAt(
  canvas: ArchitectureJSON,
  point: Point,
  dragged?: string
): string | null {
  const skip = dragged ? descendants(canvas, dragged) : new Set<string>()
  const layout = toLayoutNodes(canvas)
  let best: string | null = null
  let bestArea = Infinity
  for (const n of canvas.nodes) {
    if (n.kind === 'system' || skip.has(n.id)) continue
    const r = absoluteRect(layout, n.id)
    if (
      point.x >= r.x &&
      point.x <= r.x + r.w &&
      point.y >= r.y &&
      point.y <= r.y + r.h &&
      r.w * r.h < bestArea
    ) {
      best = n.id
      bestArea = r.w * r.h
    }
  }
  return best
}

export type PaletteItem = {
  kind: 'host' | 'system' | 'group'
  catalog: string | null
  name: string
}

function uniqueName(canvas: ArchitectureJSON, base: string) {
  const taken = new Set(canvas.nodes.map((n) => n.name))
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base} ${i}`)) i++
  return `${base} ${i}`
}

const dimsOf = (kind: PaletteItem['kind']) =>
  kind === 'system'
    ? { w: SYSTEM_W, h: SYSTEM_H }
    : kind === 'group'
      ? NEW_GROUP
      : NEW_HOST

/** Where an item from the palette would land at this point: a slot or band inside a container, or centred on it. */
export function landingFor(
  canvas: ArchitectureJSON,
  kind: PaletteItem['kind'],
  point: Point,
  dragged?: string
) {
  const container = containerAt(canvas, point, dragged)
  const layout = toLayoutNodes(canvas)
  const dims = dimsOf(kind)
  if (!container) {
    const rect: Rect =
      kind === 'system'
        ? { x: point.x - SYSTEM_W / 2, y: point.y - SYSTEM_H / 2, ...dims }
        : { x: point.x - dims.w / 2, y: point.y - LABEL / 2, ...dims }
    return { container: null, rect }
  }
  const rect =
    kind === 'system'
      ? slotFor(layout, container, point, dragged)
      : bandFor(layout, container, dims, dragged)
  return { container, rect }
}

/** Adds an item from the palette at a canvas point; returns its id. */
export function addFromPalette(
  doc: Y.Doc,
  canvas: ArchitectureJSON,
  item: PaletteItem,
  point: Point
) {
  const { container, rect } = landingFor(canvas, item.kind, point)
  const origin = container
    ? absoluteRect(toLayoutNodes(canvas), container)
    : { x: 0, y: 0 }
  const name = uniqueName(canvas, item.name)
  const position = {
    x: Math.round(rect.x - origin.x),
    y: Math.round(rect.y - origin.y),
    parentId: container,
  }
  const id =
    item.kind === 'system'
      ? addSystem(doc, {
          catalog: item.catalog ?? 'service',
          name,
          ...position,
        })
      : addContainer(doc, {
          kind: item.kind,
          catalog: item.catalog,
          name,
          w: rect.w,
          h: rect.h,
          ...position,
        })
  const after = withNode(canvas, {
    id,
    kind: item.kind,
    ...position,
    w: item.kind === 'system' ? null : rect.w,
    h: item.kind === 'system' ? null : rect.h,
  })
  applyPatches(doc, growToFit(toLayoutNodes(after), container))
  return id
}

function withNode(
  canvas: ArchitectureJSON,
  node: LayoutNode
): ArchitectureJSON {
  return {
    ...canvas,
    nodes: [
      ...canvas.nodes,
      {
        ...node,
        name: '',
        catalog: null,
        tags: [],
        description: '',
        repoUrl: null,
        links: [],
      },
    ],
  }
}

function applyLocal(
  canvas: ArchitectureJSON,
  patches: Patch[]
): ArchitectureJSON {
  return {
    ...canvas,
    nodes: canvas.nodes.map((n) => {
      const patch = patches.find((p) => p.id === n.id)
      return patch ? { ...n, ...patch } : n
    }),
  }
}

/**
 * Settles an element where a drag ended. Inside a container it stays inside,
 * clamped to the padding, and the container grows. At the top level, dropped on
 * a container, it goes into that container's slot (or band); elsewhere it stays.
 * `position` is relative to the element's current parent; `pointer` is on the canvas.
 */
export function dropElement(
  doc: Y.Doc,
  canvas: ArchitectureJSON,
  id: string,
  position: Point,
  pointer: Point
) {
  const node = canvas.nodes.find((n) => n.id === id)
  if (!node) return
  let patches: Patch[]
  if (node.parentId) {
    patches = [
      {
        id,
        x: Math.max(PAD, Math.round(position.x)),
        y: Math.max(LABEL, Math.round(position.y)),
      },
    ]
    const after = applyLocal(canvas, patches)
    patches = [...patches, ...growToFit(toLayoutNodes(after), node.parentId)]
  } else {
    const moved = applyLocal(canvas, [{ id, x: position.x, y: position.y }])
    const { container, rect } = landingFor(moved, node.kind, pointer, id)
    if (!container) {
      patches = [{ id, x: Math.round(position.x), y: Math.round(position.y) }]
    } else {
      // Children keep their place relative to the element that moves with them.
      patches = placeInside(toLayoutNodes(moved), id, container, {
        x: rect.x,
        y: rect.y,
      })
      const after = applyLocal(moved, patches)
      patches = [...patches, ...growToFit(toLayoutNodes(after), container)]
    }
  }
  applyPatches(doc, patches)
}

export function takeOutElement(
  doc: Y.Doc,
  canvas: ArchitectureJSON,
  id: string
) {
  const patches = takeOut(toLayoutNodes(canvas), id)
  if (!patches.length) return
  const after = applyLocal(canvas, patches)
  applyPatches(doc, [
    ...patches,
    ...growToFit(toLayoutNodes(after), patches[0]!.parentId ?? null),
  ])
}

export function fitElement(doc: Y.Doc, canvas: ArchitectureJSON, id: string) {
  applyPatches(doc, fitToContents(toLayoutNodes(canvas), id))
}

/**
 * Sets a container's box (relative to its parent). When the top-left corner moves
 * the children are moved back by the same amount, so they stay where they are on screen.
 */
export function resizeElement(
  doc: Y.Doc,
  canvas: ArchitectureJSON,
  id: string,
  box: Rect
) {
  const node = canvas.nodes.find((n) => n.id === id)
  if (!node) return
  const dx = Math.round(box.x) - node.x
  const dy = Math.round(box.y) - node.y
  const patches: Patch[] = [
    {
      id,
      x: Math.round(box.x),
      y: Math.round(box.y),
      w: Math.round(box.w),
      h: Math.round(box.h),
    },
  ]
  if (dx || dy)
    for (const child of canvas.nodes.filter((n) => n.parentId === id))
      patches.push({ id: child.id, x: child.x - dx, y: child.y - dy })
  const after = applyLocal(canvas, patches)
  applyPatches(doc, [
    ...patches,
    ...growToFit(toLayoutNodes(after), node.parentId),
  ])
}

/** Whether a container box (relative to its parent) still holds every child with padding. */
export function boxHoldsChildren(
  canvas: ArchitectureJSON,
  id: string,
  box: Rect
) {
  const node = canvas.nodes.find((n) => n.id === id)
  if (!node) return false
  const dx = box.x - node.x
  const dy = box.y - node.y
  return canvas.nodes
    .filter((n) => n.parentId === id)
    .every((child) => {
      const w = child.kind === 'system' ? SYSTEM_W : (child.w ?? NEW_HOST.w)
      const h = child.kind === 'system' ? SYSTEM_H : (child.h ?? NEW_HOST.h)
      const x = child.x - dx
      const y = child.y - dy
      return (
        x >= PAD && y >= LABEL && x + w + PAD <= box.w && y + h + PAD <= box.h
      )
    })
}
