/**
 * A room is named `{workspaceID}.{documentID}`. A DBML or Mermaid room also names
 * the record it holds, `{workspaceID}.{documentID}.{replacementID}`: a restore
 * gives the document a new record, and a room or device copy of the old one is stale.
 */
export function parseRoom(name: string): { workspaceID: string; documentID: string; replacementID?: string } | null {
  const [workspaceID, documentID, replacementID, ...rest] = name.split('.')
  if (!workspaceID || !documentID || replacementID === '' || rest.length) return null
  return replacementID ? { workspaceID, documentID, replacementID } : { workspaceID, documentID }
}
