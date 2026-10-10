import * as Y from 'yjs'
import { decodeBase64, encodeBase64 } from './collab-encoding'

/** Where a comment sits in a DBML or Mermaid source: two Yjs relative positions, as base64. */
export type SourceAnchor = { kind: 'source'; start: string; end: string }

/**
 * Anchors the words from `from` to `to`. The start sticks to what follows it and
 * the end to what comes before, so typing against either edge leaves the words
 * as they were and typing inside them widens it.
 */
export function createSourceAnchor(
  text: Y.Text,
  from: number,
  to: number
): SourceAnchor | null {
  if (to <= from) return null
  const start = Y.createRelativePositionFromTypeIndex(text, from, 0)
  const end = Y.createRelativePositionFromTypeIndex(text, to, -1)
  return {
    kind: 'source',
    start: encodeBase64(Y.encodeRelativePosition(start)),
    end: encodeBase64(Y.encodeRelativePosition(end)),
  }
}

/** Where the words are now, or null once they are gone or the anchor cannot be read. */
export function resolveSourceAnchor(
  doc: Y.Doc,
  text: Y.Text,
  anchor: SourceAnchor
): { from: number; to: number } | null {
  try {
    const start = Y.createAbsolutePositionFromRelativePosition(
      Y.decodeRelativePosition(decodeBase64(anchor.start)),
      doc
    )
    const end = Y.createAbsolutePositionFromRelativePosition(
      Y.decodeRelativePosition(decodeBase64(anchor.end)),
      doc
    )
    if (!start || !end || start.type !== text || end.type !== text) return null
    return end.index > start.index ? { from: start.index, to: end.index } : null
  } catch {
    return null
  }
}
