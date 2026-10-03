import { Fragment, type Node as ProseMirrorNode } from 'prosemirror-model'

// DeleteNode removes exactly the subtrees it is given. If that leaves a parent
// that must hold something (a list item holds a block, a list holds an item)
// with nothing in it, the stored body has a node the editor cannot show, and the
// editor's own repair is an ordinary update that deletes it, which the server
// refuses. So when every child of such a parent is being deleted, the parent is
// deleted instead, and so on upwards.

const idOf = (node: ProseMirrorNode) =>
  typeof node.attrs.nodeID === 'string' ? (node.attrs.nodeID as string) : null

/** The nodes to send to DeleteNode for `nodeIDs`, with parents that would be left empty standing in for their children. */
export function withEmptiedParents(
  doc: ProseMirrorNode,
  nodeIDs: string[]
): string[] {
  const wanted = new Set(nodeIDs)
  const parents: { node: ProseMirrorNode; children: string[] }[] = []
  doc.descendants((node) => {
    const id = idOf(node)
    if (!id || node.type.name === 'document' || !node.childCount) return true
    if (node.type.validContent(Fragment.empty)) return true
    const children: string[] = []
    node.forEach((child) => {
      const childID = idOf(child)
      if (childID) children.push(childID)
    })
    if (children.length === node.childCount) parents.push({ node, children })
    return true
  })

  let changed = true
  while (changed) {
    changed = false
    for (const { node, children } of parents) {
      const id = idOf(node)!
      if (wanted.has(id) || !children.every((child) => wanted.has(child)))
        continue
      for (const child of children) wanted.delete(child)
      wanted.add(id)
      changed = true
    }
  }
  return [...wanted]
}
