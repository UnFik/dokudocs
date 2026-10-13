import { createHash } from 'node:crypto'
import * as Y from 'yjs'
import { AgentEditError } from './agent-edit'
import { architectureLimits, architectureToJSON, type ArchitectureJSON } from './architecture'
import { addConnection, addContainer, addSystem, applyPatches, removeElement, updateConnection, updateNode } from '../../frontend/src/features/architecture/lib/canvas-doc'
import { toLayoutNodes } from '../../frontend/src/features/architecture/lib/canvas-actions'
import { absoluteRect, bandFor, GAP, growToFit, LABEL, NEW_GROUP, NEW_HOST, PAD, slotFor, type Patch } from '../../frontend/src/features/architecture/lib/layout'

/** The canvas as the Agent reads it: ids, places, and every field of each element. */
export function architectureText(doc: Y.Doc): string {
  return JSON.stringify(architectureToJSON(doc))
}

/**
 * A fingerprint of what the diagram says. Where a box sits and how big it is do not
 * count, so a person nudging a Host does not void a change waiting for approval.
 */
export function architectureVersion(json: ArchitectureJSON): string {
  const nodes = json.nodes.map(({ x, y, w, h, ...meaning }) => meaning)
  return createHash('sha256').update(JSON.stringify({ nodes, connections: json.connections })).digest('hex').slice(0, 16)
}

export type ArchitectureEditResult = {
  created: Record<string, string>
  removed: { nodes: number; connections: number }
}

type Operation = Record<string, unknown> & { type?: unknown }
type Kind = 'host' | 'system' | 'group'

const maxOperations = 50
const kinds: Kind[] = ['host', 'system', 'group']
const title = (kind: string) => kind[0]!.toUpperCase() + kind.slice(1)
const fail = (message: string): never => {
  throw new AgentEditError(message)
}

function text(value: unknown, what: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) fail(`${what} must be text`)
  return (value as string).trim()
}
const optionalText = (value: unknown, what: string) => (value === undefined ? undefined : text(value, what, true))
const optionalNullable = (value: unknown, what: string) => (value === undefined || value === null ? value : text(value, what, true))
function strings(value: unknown, what: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) fail(`${what} must be a list of text`)
  return value as string[]
}
function numbers(op: Operation): { x?: number; y?: number; w?: number; h?: number } {
  const out: { x?: number; y?: number; w?: number; h?: number } = {}
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    const value = op[key]
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${key} must be a number`)
    out[key] = Math.round(value as number)
  }
  return out
}

/** One call's operations, run on a copy of the canvas so a failure leaves the real one untouched. */
class Run {
  readonly refs = new Map<string, string>()
  readonly created: Record<string, string> = {}
  readonly removed = { nodes: 0, connections: 0 }
  constructor(private readonly doc: Y.Doc) {}

  private canvas() {
    return architectureToJSON(this.doc)
  }

  private newRef(op: Operation): string | undefined {
    if (op.ref === undefined) return undefined
    const ref = text(op.ref, 'ref')
    if (this.refs.has(ref)) fail(`the ref "${ref}" is used twice`)
    return ref
  }

  private remember(ref: string | undefined, id: string) {
    if (!ref) return
    this.refs.set(ref, id)
    this.created[ref] = id
  }

  /** A node or Connection by id, or by the ref an earlier operation gave it. */
  private resolve(value: unknown): string {
    const name = text(value, 'an id')
    const id = this.refs.get(name) ?? name
    const canvas = this.canvas()
    if (!canvas.nodes.some((n) => n.id === id) && !canvas.connections.some((c) => c.id === id)) fail(`there is no element "${name}"`)
    return id
  }

  private node(value: unknown) {
    const id = this.resolve(value)
    const found = this.canvas().nodes.find((n) => n.id === id)
    if (!found) return fail(`"${id}" is a Connection; this needs a node`)
    return found!
  }

  private container(value: unknown) {
    const parent = this.node(value)
    if (parent.kind === 'system') fail(`"${parent.name}" is a System; only a Host or Group can hold other elements`)
    return parent
  }

  private requireRoomFor(what: 'nodes' | 'connections') {
    const held = this.canvas()[what].length
    if (held >= architectureLimits[what]) fail(`a document holds at most ${architectureLimits[what]} ${what}`)
  }

  /** Where a new or moved element goes: the place asked for, or a free one in its container. */
  private placement(kind: Kind, parentId: string | null, op: Operation, skip?: string): { x: number; y: number } {
    const { x, y } = numbers(op)
    if (x !== undefined && y !== undefined) return parentId ? { x: Math.max(PAD, x), y: Math.max(LABEL, y) } : { x, y }
    const layout = toLayoutNodes(this.canvas()).filter((n) => n.id !== skip)
    if (parentId) {
      const box = absoluteRect(layout, parentId)
      const rect = kind === 'system'
        ? slotFor(layout, parentId, { x: box.x, y: box.y })
        : bandFor(layout, parentId, kind === 'group' ? NEW_GROUP : NEW_HOST)
      return { x: Math.round(rect.x - box.x), y: Math.round(rect.y - box.y) }
    }
    const top = layout.filter((n) => !n.parentId).map((n) => absoluteRect(layout, n.id))
    if (!top.length) return { x: 0, y: 0 }
    return { x: Math.min(...top.map((r) => r.x)), y: Math.max(...top.map((r) => r.y + r.h)) + 2 * GAP }
  }

  private growAround(parentId: string | null) {
    if (parentId) applyPatches(this.doc, growToFit(toLayoutNodes(this.canvas()), parentId))
  }

  apply(op: Operation) {
    switch (op.type) {
      case 'add_node': return this.addNode(op)
      case 'update_node': return this.updateNode(op)
      case 'move_node': return this.moveNode(op)
      case 'remove_node': return this.removeNode(op)
      case 'add_connection': return this.addConnection(op)
      case 'update_connection': return this.updateConnection(op)
      case 'remove_connection': return this.removeConnection(op)
      case 'link_document': return this.link(op, true)
      case 'unlink_document': return this.link(op, false)
      default: return fail(`unknown operation ${JSON.stringify(op.type)}`)
    }
  }

  private addNode(op: Operation) {
    const ref = this.newRef(op)
    const kind = op.kind as Kind
    if (!kinds.includes(kind)) fail('kind must be host, system or group')
    const name = typeof op.name === 'string' && op.name.trim() ? op.name.trim() : fail('a node needs a name')
    if (kind === 'system' && (op.w !== undefined || op.h !== undefined)) fail('only a Host or Group has a size')
    this.requireRoomFor('nodes')
    const parentId = op.parent === undefined || op.parent === null ? null : this.container(op.parent).id
    const catalog = optionalNullable(op.catalog, 'catalog')
    const where = this.placement(kind, parentId, op)
    const dims = kind === 'group' ? NEW_GROUP : NEW_HOST
    const size = numbers(op)
    const id = kind === 'system'
      ? addSystem(this.doc, { catalog: (catalog as string | undefined) ?? 'service', name, parentId, ...where })
      : addContainer(this.doc, { kind, catalog: (catalog as string | null | undefined) ?? null, name, parentId, ...where, w: size.w ?? dims.w, h: size.h ?? dims.h })
    updateNode(this.doc, id, { tags: strings(op.tags, 'tags'), description: optionalText(op.description, 'description'), repoUrl: optionalNullable(op.repoUrl, 'repoUrl') })
    this.remember(ref, id)
    this.growAround(parentId)
  }

  private updateNode(op: Operation) {
    const node = this.node(op.id)
    updateNode(this.doc, node.id, {
      name: op.name === undefined ? undefined : text(op.name, 'name'),
      catalog: optionalNullable(op.catalog, 'catalog'),
      tags: strings(op.tags, 'tags'),
      description: optionalText(op.description, 'description'),
      repoUrl: optionalNullable(op.repoUrl, 'repoUrl'),
    })
  }

  private moveNode(op: Operation) {
    const node = this.node(op.id)
    const size = numbers(op)
    if (node.kind === 'system' && (size.w !== undefined || size.h !== undefined)) fail('only a Host or Group has a size')
    let parentId = node.parentId
    if (op.parent !== undefined) {
      parentId = op.parent === null ? null : this.container(op.parent).id
      if (parentId === node.id) fail(`"${node.name}" cannot be placed inside itself`)
      if (parentId && this.holds(node.id, parentId)) fail(`"${node.name}" cannot be placed inside something it holds`)
    }
    const patch: Patch = { id: node.id, parentId }
    if (parentId !== node.parentId || op.x !== undefined || op.y !== undefined) Object.assign(patch, this.placement(node.kind, parentId, op, node.id))
    if (size.w !== undefined) patch.w = size.w
    if (size.h !== undefined) patch.h = size.h
    applyPatches(this.doc, [patch])
    this.growAround(parentId)
  }

  private holds(ancestorId: string, id: string): boolean {
    const nodes = this.canvas().nodes
    for (let at = nodes.find((n) => n.id === id); at?.parentId; at = nodes.find((n) => n.id === at!.parentId)) {
      if (at.parentId === ancestorId) return true
    }
    return false
  }

  private removeNode(op: Operation) {
    const node = this.node(op.id)
    const inside = this.canvas().nodes.filter((n) => n.id !== node.id && this.holds(node.id, n.id)).length
    if (inside && op.cascade !== true) fail(`"${node.name}" holds ${inside} elements; pass cascade: true to remove them with it`)
    this.count(removeElement(this.doc, node.id))
  }

  private count(done: { nodes: number; connections: number }) {
    this.removed.nodes += done.nodes
    this.removed.connections += done.connections
  }

  private system(value: unknown) {
    const node = this.node(value)
    if (node.kind !== 'system') fail(`"${node.name}" is a ${title(node.kind)}; a Connection joins two Systems`)
    return node
  }

  private addConnection(op: Operation) {
    const ref = this.newRef(op)
    const source = this.system(op.source)
    const target = this.system(op.target)
    if (source.id === target.id) fail('a Connection cannot join a System to itself')
    const protocol = typeof op.protocol === 'string' && op.protocol.trim() ? op.protocol.trim() : fail('a Connection needs a protocol')
    this.requireRoomFor('connections')
    const id = addConnection(this.doc, { source: source.id, target: target.id, protocol })
    updateConnection(this.doc, id, { label: optionalText(op.label, 'label'), port: optionalNullable(op.port, 'port') })
    this.remember(ref, id)
  }

  private connection(value: unknown) {
    const id = this.resolve(value)
    return this.canvas().connections.find((c) => c.id === id) ?? fail(`"${id}" is a node; this needs a Connection`)
  }

  private updateConnection(op: Operation) {
    const connection = this.connection(op.id)
    updateConnection(this.doc, connection.id, {
      protocol: op.protocol === undefined ? undefined : text(op.protocol, 'protocol'),
      label: optionalText(op.label, 'label'),
      port: optionalNullable(op.port, 'port'),
    })
  }

  private removeConnection(op: Operation) {
    this.count(removeElement(this.doc, this.connection(op.id).id))
  }

  private link(op: Operation, add: boolean) {
    const id = this.resolve(op.id)
    const document = text(op.document_id, 'document_id')
    const canvas = this.canvas()
    const current = canvas.nodes.find((n) => n.id === id)?.links ?? canvas.connections.find((c) => c.id === id)?.links ?? []
    const links = add ? (current.includes(document) ? current : [...current, document]) : current.filter((d) => d !== document)
    if (canvas.nodes.some((n) => n.id === id)) updateNode(this.doc, id, { links })
    else updateConnection(this.doc, id, { links })
  }
}

/**
 * Applies the Agent's operations to the canvas in `doc` as one change: either every
 * operation lands or none does, and a refusal names the operation that caused it.
 */
export function applyArchitectureOperations(doc: Y.Doc, operations: unknown): ArchitectureEditResult {
  if (!Array.isArray(operations) || operations.length === 0) fail('there are no operations')
  const list = operations as Operation[]
  if (list.length > maxOperations) fail(`at most ${maxOperations} operations at a time`)
  const scratch = new Y.Doc()
  try {
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc))
    const run = new Run(scratch)
    list.forEach((op, index) => {
      try {
        if (!op || typeof op !== 'object') fail('an operation must be an object')
        run.apply(op)
      } catch (error) {
        if (error instanceof AgentEditError) throw new AgentEditError(`operation ${index + 1}: ${error.message}`)
        throw error
      }
    })
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(scratch, Y.encodeStateVector(doc)))
    return { created: run.created, removed: run.removed }
  } finally {
    scratch.destroy()
  }
}
