export interface BodyNode {
  nodeID: string;
  parentID: string | null;
  siblingOrder: number;
}

// GET /documents/:id/body returns nodes in no guaranteed order. Rebuild the
// document order (depth first, siblings by siblingOrder) before comparing.
export function inDocumentOrder<T extends BodyNode>(nodes: T[]): T[] {
  const children = new Map<string | null, T[]>();
  for (const node of nodes) {
    const list = children.get(node.parentID) ?? [];
    list.push(node);
    children.set(node.parentID, list);
  }
  for (const list of children.values())
    list.sort((a, b) => a.siblingOrder - b.siblingOrder);
  const ordered: T[] = [];
  const visit = (parentID: string | null) => {
    for (const node of children.get(parentID) ?? []) {
      ordered.push(node);
      visit(node.nodeID);
    }
  };
  visit(null);
  return ordered;
}
