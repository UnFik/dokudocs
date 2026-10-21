import type {
  ArchitectureConnection,
  ArchitectureJSON,
  ArchitectureNode,
} from './canvas-model'
import type { Selected } from './canvas-selection'

/** One Connection seen from a System: which way it goes and who is at the other end. */
export type SystemConnection = {
  connection: ArchitectureConnection
  direction: 'out' | 'in'
  other: ArchitectureNode | undefined
}

export function connectionsOf(
  canvas: ArchitectureJSON,
  systemID: string
): SystemConnection[] {
  const byID = new Map(canvas.nodes.map((n) => [n.id, n]))
  return canvas.connections.flatMap<SystemConnection>((connection) => {
    if (connection.source === systemID)
      return [
        { connection, direction: 'out', other: byID.get(connection.target) },
      ]
    if (connection.target === systemID)
      return [
        { connection, direction: 'in', other: byID.get(connection.source) },
      ]
    return []
  })
}

export type Focus = { nodes: Set<string>; edges: Set<string> }

/**
 * What stands out while one System is selected: that System, its Connections and
 * the Systems at their other ends. Null for any other selection.
 */
export function focusOf(
  canvas: ArchitectureJSON,
  selection: Selected[]
): Focus | null {
  const only = selection.length === 1 ? selection[0]! : null
  if (!only || only.kind !== 'node') return null
  const node = canvas.nodes.find((n) => n.id === only.id)
  if (node?.kind !== 'system') return null
  const nodes = new Set([node.id])
  const edges = new Set<string>()
  for (const { connection, other } of connectionsOf(canvas, node.id)) {
    edges.add(connection.id)
    if (other) nodes.add(other.id)
  }
  return { nodes, edges }
}

/** The one System or Connection a selection holds, with the documents it links to; null for anything else. */
export function linkedElement(canvas: ArchitectureJSON, selection: Selected[]) {
  const only = selection.length === 1 ? selection[0]! : null
  if (!only) return null
  if (only.kind === 'edge') {
    const connection = canvas.connections.find((c) => c.id === only.id)
    if (!connection) return null
    const names = [connection.source, connection.target].map(
      (id) => canvas.nodes.find((n) => n.id === id)?.name || 'Untitled'
    )
    return {
      kind: 'connection' as const,
      id: connection.id,
      title: `${names[0]} → ${names[1]}`,
      links: connection.links,
    }
  }
  const node = canvas.nodes.find((n) => n.id === only.id)
  if (node?.kind !== 'system') return null
  return {
    kind: 'system' as const,
    id: node.id,
    title: node.name || 'Untitled',
    links: node.links,
  }
}
