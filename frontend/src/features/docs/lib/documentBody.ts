export interface DocumentBodyNode {
  nodeID: string
  parentID: string | null
  siblingOrder: number
  type: string
  content: string
  attributes: Record<string, unknown>
}

export function indexDocumentBody(nodes: DocumentBodyNode[]) {
  if (!nodes.length) throw new Error('document body is empty')
  const byID = new Map<string, DocumentBodyNode>()
  const children = new Map<string, DocumentBodyNode[]>()
  const roots: DocumentBodyNode[] = []

  for (const node of nodes) {
    if (
      !node.nodeID ||
      !node.type ||
      typeof node.content !== 'string' ||
      !Number.isFinite(node.siblingOrder) ||
      !isObject(node.attributes)
    )
      throw new Error('document body contains an invalid node')
    if (byID.has(node.nodeID))
      throw new Error(`duplicate document body node ${node.nodeID}`)
    byID.set(node.nodeID, node)
    if (node.parentID === null) roots.push(node)
    else {
      const siblings = children.get(node.parentID) ?? []
      siblings.push(node)
      children.set(node.parentID, siblings)
    }
  }

  if (roots.length !== 1 || roots[0]!.type !== 'document')
    throw new Error('document body must have one document root')
  const rootAttributes = roots[0]!.attributes
  const trailingWhitespace = rootAttributes.trailingWhitespace
  const sourceGaps = rootAttributes.sourceGaps
  const sourceTables = rootAttributes.sourceTables
  if (
    roots[0]!.content !== '' ||
    Object.keys(rootAttributes).some(
      (key) =>
        key !== 'trailingWhitespace' &&
        key !== 'sourceGaps' &&
        key !== 'sourceTables'
    ) ||
    (trailingWhitespace !== undefined &&
      (typeof trailingWhitespace !== 'string' ||
        !/^[ \t\r\n]*$/.test(trailingWhitespace))) ||
    (sourceGaps !== undefined && !isSourceGapMap(sourceGaps)) ||
    (sourceTables !== undefined && !isSourceTableMap(sourceTables))
  )
    throw new Error('document root contains invalid metadata or content')
  for (const [parentID, siblings] of children) {
    if (!byID.has(parentID))
      throw new Error(`document body node has missing parent ${parentID}`)
    siblings.sort((left, right) => left.siblingOrder - right.siblingOrder)
    for (let i = 1; i < siblings.length; i++)
      if (siblings[i - 1]!.siblingOrder === siblings[i]!.siblingOrder)
        throw new Error(`duplicate sibling order under ${parentID}`)
  }

  const childNodes = (parentID: string) => children.get(parentID) ?? []
  const visited = new Set<string>()
  const pending = [roots[0]!]
  while (pending.length) {
    const node = pending.pop()!
    if (visited.has(node.nodeID))
      throw new Error('document body contains a cycle')
    visited.add(node.nodeID)
    pending.push(...childNodes(node.nodeID))
  }
  if (visited.size !== nodes.length)
    throw new Error('document body contains nodes outside its root')

  return { root: roots[0]!, children: childNodes }
}

function isSourceTableMap(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([nodeID, markdown]) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          nodeID
        ) &&
        typeof markdown === 'string' &&
        markdown.length > 0
    )
  )
}

function isSourceGapMap(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([nodeID, gap]) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          nodeID
        ) &&
        typeof gap === 'string' &&
        /^[ \t\r\n]*$/.test(gap)
    )
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
