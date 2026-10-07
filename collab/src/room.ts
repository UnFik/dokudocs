/** A room is named `{workspaceID}.{documentID}`. */
export function parseRoom(name: string): { workspaceID: string; documentID: string } | null {
  const [workspaceID, documentID, ...rest] = name.split('.')
  if (!workspaceID || !documentID || rest.length) return null
  return { workspaceID, documentID }
}
