import * as Y from 'yjs'

// A DBML or Mermaid document is one shared text, its DiagramSource (ADR 0033).
// The editor binds Monaco to the same text.
export const sourceName = 'source'
// Every build uses this client id, so building twice gives the same operations (as `seed.ts`).
const seedClientID = 0x5eed

export type SourceJSON = { source: string }

/** The editor cannot hold mixed line endings, so every source is kept with LF. */
export const normalizeSource = (source: string) => source.replace(/\r\n?/g, '\n')

/** The source a stored document carries, or '' when the JSON holds none. */
export function sourceOf(content: unknown): string {
  const source = (content as { source?: unknown } | null)?.source
  return typeof source === 'string' ? normalizeSource(source) : ''
}

/** The Yjs state of a document made from JSON alone (a create, an import, a restore). */
export function seedSource(content: unknown): Uint8Array {
  const doc = new Y.Doc()
  doc.clientID = seedClientID
  const source = sourceOf(content)
  if (source) doc.getText(sourceName).insert(0, source)
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return update
}

export function sourceToJSON(doc: Y.Doc): SourceJSON {
  return { source: doc.getText(sourceName).toString() }
}
