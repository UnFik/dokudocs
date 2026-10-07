import * as Y from 'yjs'
import { architectureToJSON, type ArchitectureJSON } from './canvas-model'
import type { Patch } from './layout'

// Every change the editor makes to an Architecture document goes through here, in
// one transaction per gesture, with this origin so undo only takes back our own.
export const localOrigin = Symbol('architecture-editor')

type NodeMap = Y.Map<Y.Map<unknown>>

const nodesOf = (doc: Y.Doc) => doc.getMap('nodes') as NodeMap
const connectionsOf = (doc: Y.Doc) => doc.getMap('connections') as NodeMap
const list = (values: string[]) => {
  const array = new Y.Array<string>()
  array.push(values)
  return array
}

export function readCanvas(doc: Y.Doc): ArchitectureJSON {
  return architectureToJSON(doc)
}

export type NewSystem = { catalog: string; name: string; x: number; y: number; parentId: string | null; id?: string }
export type NewContainer = {
  kind: 'host' | 'group'
  catalog: string | null
  name: string
  x: number
  y: number
  w: number
  h: number
  parentId: string | null
  id?: string
}

function addNode(doc: Y.Doc, fields: Record<string, unknown>, id: string = crypto.randomUUID()) {
  doc.transact(() => {
    const m = new Y.Map<unknown>()
    nodesOf(doc).set(id, m)
    for (const [key, value] of Object.entries(fields)) m.set(key, value)
    m.set('tags', list([]))
    m.set('links', list([]))
  }, localOrigin)
  return id
}

export function addSystem(doc: Y.Doc, input: NewSystem) {
  return addNode(
    doc,
    { kind: 'system', parentId: input.parentId, x: input.x, y: input.y, w: null, h: null, name: input.name, catalog: input.catalog, description: '', repoUrl: null },
    input.id
  )
}

export function addContainer(doc: Y.Doc, input: NewContainer) {
  return addNode(
    doc,
    { kind: input.kind, parentId: input.parentId, x: input.x, y: input.y, w: input.w, h: input.h, name: input.name, catalog: input.catalog, description: '', repoUrl: null },
    input.id
  )
}

export function addConnection(doc: Y.Doc, input: { source: string; target: string; protocol: string; id?: string }) {
  const id = input.id ?? crypto.randomUUID()
  doc.transact(() => {
    const m = new Y.Map<unknown>()
    connectionsOf(doc).set(id, m)
    m.set('source', input.source)
    m.set('target', input.target)
    m.set('protocol', input.protocol)
    m.set('label', '')
    m.set('port', null)
    m.set('links', list([]))
  }, localOrigin)
  return id
}

function setFields(target: Y.Map<unknown> | undefined, fields: Record<string, unknown>) {
  if (!target) return
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      const current = target.get(key)
      if (current instanceof Y.Array) {
        current.delete(0, current.length)
        current.push(value)
      } else {
        target.set(key, list(value))
      }
    } else if (target.get(key) !== value) {
      target.set(key, value)
    }
  }
}

export type NodeFields = Partial<{
  name: string
  catalog: string | null
  tags: string[]
  description: string
  repoUrl: string | null
  links: string[]
}>

export function updateNode(doc: Y.Doc, id: string, fields: NodeFields) {
  doc.transact(() => setFields(nodesOf(doc).get(id), fields), localOrigin)
}

export type ConnectionFields = Partial<{ protocol: string; label: string; port: string | null; links: string[] }>

export function updateConnection(doc: Y.Doc, id: string, fields: ConnectionFields) {
  doc.transact(() => setFields(connectionsOf(doc).get(id), fields), localOrigin)
}

/** Writes layout patches (positions, sizes, parents) as one change. */
export function applyPatches(doc: Y.Doc, patches: Patch[]) {
  if (!patches.length) return
  doc.transact(() => {
    for (const { id, ...fields } of patches) setFields(nodesOf(doc).get(id), fields)
  }, localOrigin)
}

/**
 * Removes a node with everything inside it and every Connection touching them,
 * or one Connection. Linked documents are only referenced: they are counted,
 * never removed (plan: "Deleting never cascades to documents").
 */
export function removeElement(doc: Y.Doc, id: string) {
  const nodes = nodesOf(doc)
  const connections = connectionsOf(doc)
  const json = readCanvas(doc)
  const removedNodes = new Set<string>()
  if (nodes.has(id)) {
    removedNodes.add(id)
    for (let grew = true; grew; ) {
      grew = false
      for (const n of json.nodes) {
        if (n.parentId && removedNodes.has(n.parentId) && !removedNodes.has(n.id)) {
          removedNodes.add(n.id)
          grew = true
        }
      }
    }
  }
  const removedConnections = json.connections.filter(
    (c) => c.id === id || removedNodes.has(c.source) || removedNodes.has(c.target)
  )
  const documents = new Set<string>()
  for (const n of json.nodes) if (removedNodes.has(n.id)) n.links.forEach((d) => documents.add(d))
  for (const c of removedConnections) c.links.forEach((d) => documents.add(d))
  doc.transact(() => {
    removedNodes.forEach((n) => nodes.delete(n))
    removedConnections.forEach((c) => connections.delete(c.id))
  }, localOrigin)
  return { nodes: removedNodes.size, connections: removedConnections.length, linkedDocuments: documents.size }
}

/** Undo for this editor only: changes from other people are never taken back. */
export function createUndo(doc: Y.Doc) {
  return new Y.UndoManager([nodesOf(doc), connectionsOf(doc)], {
    trackedOrigins: new Set([localOrigin]),
    captureTimeout: 500,
  })
}
