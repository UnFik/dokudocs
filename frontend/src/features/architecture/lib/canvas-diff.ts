import type { ArchitectureJSON } from './canvas-model'

export type Change = 'added' | 'removed' | 'changed'

// What a reader compares between versions: names, types, parents, links, protocols.
// Positions and sizes are left out; moving a box is not a change in the architecture.
const nodeSignature = (n: ArchitectureJSON['nodes'][number]) =>
  JSON.stringify([
    n.kind,
    n.name,
    n.catalog,
    n.parentId,
    [...n.tags].sort(),
    n.description,
    n.repoUrl,
    [...n.links].sort(),
  ])
const connectionSignature = (c: ArchitectureJSON['connections'][number]) =>
  JSON.stringify([
    c.source,
    c.target,
    c.protocol,
    c.label,
    c.port,
    [...c.links].sort(),
  ])

/** Element id → how it differs in `after` compared with `before`; unchanged elements are absent. */
export function diffCanvases(
  before: ArchitectureJSON,
  after: ArchitectureJSON
) {
  const diff = new Map<string, Change>()
  const compare = <T extends { id: string }>(
    a: T[],
    b: T[],
    signature: (x: T) => string
  ) => {
    const old = new Map(a.map((x) => [x.id, x]))
    const next = new Map(b.map((x) => [x.id, x]))
    for (const [id, x] of next) {
      const previous = old.get(id)
      if (!previous) diff.set(id, 'added')
      else if (signature(previous) !== signature(x)) diff.set(id, 'changed')
    }
    for (const id of old.keys()) if (!next.has(id)) diff.set(id, 'removed')
  }
  compare(before.nodes, after.nodes, nodeSignature)
  compare(before.connections, after.connections, connectionSignature)
  return diff
}

/** The newer canvas with the removed elements put back where they were, so a diff can draw both. */
export function mergeForDiff(
  before: ArchitectureJSON,
  after: ArchitectureJSON
): ArchitectureJSON {
  const ids = new Set(after.nodes.map((n) => n.id))
  const connectionIDs = new Set(after.connections.map((c) => c.id))
  return {
    version: 1,
    nodes: [...after.nodes, ...before.nodes.filter((n) => !ids.has(n.id))],
    connections: [
      ...after.connections,
      ...before.connections.filter((c) => !connectionIDs.has(c.id)),
    ],
  }
}
