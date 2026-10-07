import * as Y from 'yjs'

// An Architecture document (ADR 0031): two top-level maps, one Y.Map per element,
// so two people changing different fields of one element both keep their change.

export type ArchitectureNode = {
  id: string
  kind: 'host' | 'system' | 'group'
  parentId: string | null
  x: number
  y: number
  w: number | null
  h: number | null
  name: string
  catalog: string | null
  tags: string[]
  description: string
  repoUrl: string | null
  links: string[]
}

export type ArchitectureConnection = {
  id: string
  source: string
  target: string
  protocol: string
  label: string
  port: string | null
  links: string[]
}

/** `documents.content_json` of an Architecture document. */
export type ArchitectureJSON = { version: 1; nodes: ArchitectureNode[]; connections: ArchitectureConnection[] }

/** The most a document may hold; the editor stops adding at these, the service refuses more. */
export const architectureLimits = { nodes: 500, connections: 1000 }

const NODE_FIELDS = ['kind', 'parentId', 'x', 'y', 'w', 'h', 'name', 'catalog', 'tags', 'description', 'repoUrl', 'links'] as const
const CONNECTION_FIELDS = ['source', 'target', 'protocol', 'label', 'port', 'links'] as const
const LISTS = new Set(['tags', 'links'])

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)
const strOrNull = (v: unknown) => (typeof v === 'string' ? v : null)
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const list = (v: unknown) => (v instanceof Y.Array ? v.toArray() : Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string')
const kindOf = (v: unknown): ArchitectureNode['kind'] => (v === 'host' || v === 'group' ? v : 'system')

/**
 * The JSON derived from the Yjs state, sorted by id so the same state always gives
 * the same text. Elements an editor wrote badly are read with safe defaults, and
 * a connection whose ends are gone is left out instead of breaking readers.
 */
export function architectureToJSON(doc: Y.Doc): ArchitectureJSON {
  const nodes: ArchitectureNode[] = []
  doc.getMap<Y.Map<unknown>>('nodes').forEach((m, id) => {
    if (!(m instanceof Y.Map)) return
    nodes.push({
      id,
      kind: kindOf(m.get('kind')),
      parentId: strOrNull(m.get('parentId')),
      x: num(m.get('x')),
      y: num(m.get('y')),
      w: numOrNull(m.get('w')),
      h: numOrNull(m.get('h')),
      name: str(m.get('name')),
      catalog: strOrNull(m.get('catalog')),
      tags: list(m.get('tags')),
      description: str(m.get('description')),
      repoUrl: strOrNull(m.get('repoUrl')),
      links: list(m.get('links')),
    })
  })
  const ids = new Set(nodes.map((n) => n.id))
  for (const n of nodes) if (n.parentId && !ids.has(n.parentId)) n.parentId = null
  const connections: ArchitectureConnection[] = []
  doc.getMap<Y.Map<unknown>>('connections').forEach((m, id) => {
    if (!(m instanceof Y.Map)) return
    const source = str(m.get('source'))
    const target = str(m.get('target'))
    if (!ids.has(source) || !ids.has(target)) return
    connections.push({
      id,
      source,
      target,
      protocol: str(m.get('protocol'), 'rest'),
      label: str(m.get('label')),
      port: strOrNull(m.get('port')),
      links: list(m.get('links')),
    })
  })
  const byID = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return { version: 1, nodes: nodes.sort(byID), connections: connections.sort(byID) }
}

// Every rebuild uses this client id and the same insertion order, so building twice
// gives the same operations (same rule as `seedFromJSON` for Markdown).
const seedClientID = 0x5eed

function fill(target: Y.Map<unknown>, source: Record<string, unknown>, fields: readonly string[]) {
  for (const field of fields) {
    const value = source[field]
    if (LISTS.has(field)) {
      const array = new Y.Array<string>()
      target.set(field, array)
      array.push(Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [])
    } else {
      target.set(field, value === undefined ? null : value)
    }
  }
}

/** The Yjs state of an Architecture document that only has JSON: a seed, an import, a restored revision. */
export function seedArchitecture(content: unknown): Uint8Array {
  const json = content as Partial<ArchitectureJSON> | null
  const seed = new Y.Doc()
  seed.clientID = seedClientID
  const sorted = <T extends { id: string }>(items: T[] | undefined) =>
    [...(items ?? [])].filter((x) => x && typeof x.id === 'string').sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  seed.transact(() => {
    const nodes = seed.getMap<Y.Map<unknown>>('nodes')
    for (const node of sorted(json?.nodes)) {
      const m = new Y.Map<unknown>()
      nodes.set(node.id, m)
      fill(m, node, NODE_FIELDS)
    }
    const connections = seed.getMap<Y.Map<unknown>>('connections')
    for (const connection of sorted(json?.connections)) {
      const m = new Y.Map<unknown>()
      connections.set(connection.id, m)
      fill(m, connection, CONNECTION_FIELDS)
    }
  })
  const state = Y.encodeStateAsUpdate(seed)
  seed.destroy()
  return state
}

/** How many elements the state holds, without building the JSON. */
export function countElements(doc: Y.Doc) {
  return { nodes: doc.getMap('nodes').size, connections: doc.getMap('connections').size }
}

/**
 * `documents.content`: one line per element, for search and RAG, e.g.
 * `System "Backend Order" (golang; gin) runs on Host "VPS-1".`
 */
export function architectureSummary(json: ArchitectureJSON): string {
  const byID = new Map(json.nodes.map((n) => [n.id, n]))
  const label = (kind: string) => kind[0]!.toUpperCase() + kind.slice(1)
  const host = (n: ArchitectureNode) => {
    let p = n.parentId ? byID.get(n.parentId) : undefined
    while (p && p.kind !== 'host') p = p.parentId ? byID.get(p.parentId) : undefined
    return p
  }
  const lines: string[] = []
  for (const n of json.nodes) {
    const tech = [n.catalog, ...n.tags].filter(Boolean).join('; ')
    let line = `${label(n.kind)} "${n.name}"${tech ? ` (${tech})` : ''}`
    const on = n.kind === 'group' ? undefined : host(n)
    if (on) line += ` runs on Host "${on.name}"`
    lines.push(line + '.' + (n.description ? ` ${n.description}` : ''))
  }
  for (const c of json.connections) {
    const from = byID.get(c.source)!
    const to = byID.get(c.target)!
    lines.push(`"${from.name}" calls "${to.name}" over ${c.protocol}${c.label ? ` (${c.label})` : ''}.`)
  }
  return lines.join('\n')
}

/** Document ids linked from Systems and Connections, for `architecture_document_links`. */
export function linkedDocuments(json: ArchitectureJSON) {
  const rows: { elementID: string; elementKind: 'system' | 'connection'; documentID: string }[] = []
  for (const n of json.nodes) if (n.kind === 'system') for (const d of new Set(n.links)) rows.push({ elementID: n.id, elementKind: 'system', documentID: d })
  for (const c of json.connections) for (const d of new Set(c.links)) rows.push({ elementID: c.id, elementKind: 'connection', documentID: d })
  return rows
}
