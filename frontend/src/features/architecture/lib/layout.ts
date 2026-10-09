// Geometry of Hosts and Groups on the canvas (plan: "Putting something into a Host",
// "Inside a Host", "Taking something out", "Fit to contents", "Manual resize").
// Positions are relative to the parent, as React Flow and the Yjs state keep them;
// every function returns patches in those coordinates.

export const SYSTEM_W = 132
export const SYSTEM_H = 50
export const GAP = 16
export const PAD = 14
export const LABEL = 32
export const MIN_CONTAINER = { w: 160, h: 90 }
export const NEW_HOST = { w: 200, h: 130 }
export const NEW_GROUP = { w: 220, h: 140 }

export type LayoutNode = {
  id: string
  kind: 'host' | 'system' | 'group'
  parentId: string | null
  x: number
  y: number
  w: number | null
  h: number | null
}
export type Rect = { x: number; y: number; w: number; h: number }
export type Point = { x: number; y: number }
export type Patch = {
  id: string
  parentId?: string | null
  x?: number
  y?: number
  w?: number
  h?: number
}

const byID = (nodes: LayoutNode[]) => new Map(nodes.map((n) => [n.id, n]))
const size = (n: LayoutNode) =>
  n.kind === 'system'
    ? { w: SYSTEM_W, h: SYSTEM_H }
    : { w: n.w ?? NEW_HOST.w, h: n.h ?? NEW_HOST.h }

/** Where an element is on the canvas. */
export function absoluteRect(nodes: LayoutNode[], id: string): Rect {
  const map = byID(nodes)
  const node = map.get(id)!
  let x = node.x
  let y = node.y
  for (
    let p = node.parentId ? map.get(node.parentId) : undefined;
    p;
    p = p.parentId ? map.get(p.parentId) : undefined
  ) {
    x += p.x
    y += p.y
  }
  return { x, y, ...size(node) }
}

const overlaps = (a: Rect, b: Rect, margin: number) =>
  a.x < b.x + b.w + margin &&
  a.x + a.w + margin > b.x &&
  a.y < b.y + b.h + margin &&
  a.y + a.h + margin > b.y

const childRects = (
  nodes: LayoutNode[],
  containerID: string | null,
  skip?: string
) =>
  nodes
    .filter((n) => n.parentId === containerID && n.id !== skip)
    .map((n) => absoluteRect(nodes, n.id))

const columns = (w: number) =>
  Math.max(1, Math.floor((w - 2 * PAD + GAP) / (SYSTEM_W + GAP)))

/** The free grid cell nearest the pointer; cells inside the Host's current box come before a new row. */
export function slotFor(
  nodes: LayoutNode[],
  containerID: string,
  pointer: Point,
  skip?: string
): Rect {
  const box = absoluteRect(nodes, containerID)
  const kids = childRects(nodes, containerID, skip)
  const cols = columns(box.w)
  const rowsNow = Math.max(
    1,
    Math.floor((box.h - LABEL - PAD + GAP) / (SYSTEM_H + GAP))
  )
  let best: Rect | null = null
  let bestDistance = Infinity
  for (let row = 0; row < rowsNow + 200; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = {
        x: box.x + PAD + col * (SYSTEM_W + GAP),
        y: box.y + LABEL + row * (SYSTEM_H + GAP),
        w: SYSTEM_W,
        h: SYSTEM_H,
      }
      if (kids.some((k) => overlaps(cell, k, GAP / 2 - 1))) continue
      const distance =
        Math.hypot(
          cell.x + SYSTEM_W / 2 - pointer.x,
          cell.y + SYSTEM_H / 2 - pointer.y
        ) + (row >= rowsNow ? 1e9 : 0)
      if (distance < bestDistance) {
        bestDistance = distance
        best = cell
      }
    }
    if (best && row >= rowsNow) break
  }
  return best!
}

/** Where a Host or Group of this size goes inside a container: below everything there, left-aligned. */
export function bandFor(
  nodes: LayoutNode[],
  containerID: string,
  dims: { w: number; h: number },
  skip?: string
): Rect {
  const box = absoluteRect(nodes, containerID)
  const kids = childRects(nodes, containerID, skip)
  const y = kids.length
    ? Math.max(...kids.map((k) => k.y + k.h)) + GAP
    : box.y + LABEL
  return { x: box.x + PAD, y, w: dims.w, h: dims.h }
}

/** Puts an element at an absolute point inside a container. */
export function placeInside(
  nodes: LayoutNode[],
  id: string,
  containerID: string | null,
  at: Point
): Patch[] {
  const origin = containerID ? absoluteRect(nodes, containerID) : { x: 0, y: 0 }
  return [{ id, parentId: containerID, x: at.x - origin.x, y: at.y - origin.y }]
}

/**
 * Grows a container (and the ones around it) so every child sits inside with
 * padding, toward the right and bottom. It never shrinks.
 */
export function growToFit(
  nodes: LayoutNode[],
  containerID: string | null
): Patch[] {
  const patches: Patch[] = []
  let current = nodes
  for (let id = containerID; id; ) {
    const node = current.find((n) => n.id === id)!
    const box = absoluteRect(current, id)
    const kids = childRects(current, id)
    if (kids.length) {
      const w = Math.max(
        box.w,
        Math.max(...kids.map((k) => k.x + k.w)) + PAD - box.x
      )
      const h = Math.max(
        box.h,
        Math.max(...kids.map((k) => k.y + k.h)) + PAD - box.y
      )
      if (w !== box.w || h !== box.h) {
        const patch = { id, x: node.x, y: node.y, w, h }
        patches.push(patch)
        current = current.map((n) => (n.id === id ? { ...n, w, h } : n))
      }
    }
    id = node.parentId
  }
  return patches
}

/** The smallest box around a container's children; null when it has none. */
function tightBox(nodes: LayoutNode[], containerID: string): Rect | null {
  const kids = childRects(nodes, containerID)
  if (!kids.length) return null
  const x = Math.min(...kids.map((k) => k.x)) - PAD
  const y = Math.min(...kids.map((k) => k.y)) - LABEL
  return {
    x,
    y,
    w: Math.max(...kids.map((k) => k.x + k.w)) + PAD - x,
    h: Math.max(...kids.map((k) => k.y + k.h)) + PAD - y,
  }
}

/**
 * Sets a container to the box around its children. The children stay where they
 * are on screen; the containers around it grow if they have to.
 */
export function fitToContents(
  nodes: LayoutNode[],
  containerID: string
): Patch[] {
  const tight = tightBox(nodes, containerID)
  if (!tight) return []
  const node = nodes.find((n) => n.id === containerID)!
  const box = absoluteRect(nodes, containerID)
  const dx = tight.x - box.x
  const dy = tight.y - box.y
  if (!dx && !dy && tight.w === box.w && tight.h === box.h) return []
  const patches: Patch[] = [
    { id: containerID, x: node.x + dx, y: node.y + dy, w: tight.w, h: tight.h },
  ]
  for (const child of nodes.filter((n) => n.parentId === containerID)) {
    patches.push({ id: child.id, x: child.x - dx, y: child.y - dy })
  }
  const applied = nodes.map((n) => ({
    ...n,
    ...(patches.find((p) => p.id === n.id) ?? {}),
  }))
  return [...patches, ...growToFit(applied, node.parentId)]
}

/** The smallest size a container may be resized to: its contents, or 160 x 90 when empty. */
export function minSize(nodes: LayoutNode[], containerID: string) {
  // A container just deleted is still drawn until React Flow catches up.
  if (!nodes.some((n) => n.id === containerID)) return { ...MIN_CONTAINER }
  const box = absoluteRect(nodes, containerID)
  const kids = childRects(nodes, containerID)
  if (!kids.length) return { ...MIN_CONTAINER }
  return {
    w: Math.max(
      MIN_CONTAINER.w,
      Math.max(...kids.map((k) => k.x + k.w)) + PAD - box.x
    ),
    h: Math.max(
      MIN_CONTAINER.h,
      Math.max(...kids.map((k) => k.y + k.h)) + PAD - box.y
    ),
  }
}

/** Whether a container is already the box around its children. */
export function fitsContents(nodes: LayoutNode[], containerID: string) {
  return fitToContents(nodes, containerID).length === 0
}

/**
 * Moves an element one level up: into the next free cell (or the band) of the
 * container around its container, or at the top level to the first free spot to
 * the right of the old container.
 */
export function takeOut(nodes: LayoutNode[], id: string): Patch[] {
  const node = nodes.find((n) => n.id === id)
  if (!node?.parentId) return []
  const old = absoluteRect(nodes, node.parentId)
  const up = nodes.find((n) => n.id === node.parentId)!.parentId
  const dims = size(node)
  let at: Point
  if (up) {
    at =
      node.kind === 'system'
        ? slotFor(
            nodes,
            up,
            { x: old.x + old.w + SYSTEM_W, y: old.y + SYSTEM_H },
            id
          )
        : bandFor(nodes, up, dims, id)
  } else {
    const others = childRects(nodes, null, id)
    at = { x: old.x + old.w + 24, y: old.y + old.h + 24 }
    for (let step = 0; step < 200; step++) {
      const spot = {
        x: old.x + old.w + 24,
        y: old.y + step * (SYSTEM_H + GAP),
        ...dims,
      }
      if (!others.some((o) => overlaps(spot, o, 8))) {
        at = spot
        break
      }
    }
  }
  return placeInside(nodes, id, up, at)
}
