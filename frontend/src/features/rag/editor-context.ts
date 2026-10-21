/** Severity numbers of Monaco markers; hints and infos are not sent. */
const SEVERITY_ERROR = 8
const SEVERITY_WARNING = 4

export const MAX_EDITOR_DIAGNOSTICS = 20
export const MAX_EDITOR_MESSAGE_CHARS = 500
export const MAX_EDITOR_EXCERPT_CHARS = 8000
const EXCERPT_RADIUS = 10

export type EditorKind = 'dbml' | 'mermaid'

/** A marker as the editor holds it. */
export type EditorMarker = {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
  message: string
  severity: number
}

export type EditorDiagnostic = {
  line: number
  column: number
  endLine: number
  endColumn: number
  severity: 'error' | 'warning'
  message: string
}

/** What a DBML or Mermaid editor showed when the question was sent. */
export type EditorContext = {
  documentId: string
  kind: EditorKind
  cursor: { line: number; column: number }
  diagnostics: EditorDiagnostic[]
  excerpt: { fromLine: number; toLine: number; text: string }
}

const covers = (
  marker: EditorMarker,
  cursor: { line: number; column: number }
) => {
  const after =
    cursor.line > marker.startLineNumber ||
    (cursor.line === marker.startLineNumber &&
      cursor.column >= marker.startColumn)
  const before =
    cursor.line < marker.endLineNumber ||
    (cursor.line === marker.endLineNumber && cursor.column <= marker.endColumn)
  return after && before
}

/**
 * Turns the editor's markers, cursor and source into what the server takes:
 * the error under the cursor first, then errors before warnings, then by
 * line, within the limits; the excerpt is the lines around the first one.
 */
export function buildEditorContext(input: {
  documentId: string
  kind: EditorKind
  source: string
  cursor: { line: number; column: number }
  markers: EditorMarker[]
}): EditorContext {
  const { cursor } = input
  const shown = input.markers.filter(
    (marker) =>
      marker.severity === SEVERITY_ERROR || marker.severity === SEVERITY_WARNING
  )
  const rank = (marker: EditorMarker) =>
    covers(marker, cursor) ? 0 : marker.severity === SEVERITY_ERROR ? 1 : 2
  const ordered = shown
    .map((marker, index) => ({ marker, index }))
    .sort(
      (a, b) =>
        rank(a.marker) - rank(b.marker) ||
        a.marker.startLineNumber - b.marker.startLineNumber ||
        a.index - b.index
    )
    .map(({ marker }) => marker)
    .slice(0, MAX_EDITOR_DIAGNOSTICS)

  const sourceLines = input.source.split('\n')
  const focus = ordered[0]?.startLineNumber ?? cursor.line
  const from = Math.max(1, focus - EXCERPT_RADIUS)
  let to = Math.min(sourceLines.length, focus + EXCERPT_RADIUS)
  const kept: string[] = []
  let size = 0
  for (let line = from; line <= to; line++) {
    const text = sourceLines[line - 1]
    const next = size + text.length + (kept.length ? 1 : 0)
    if (next > MAX_EDITOR_EXCERPT_CHARS) {
      to = line - 1
      break
    }
    kept.push(text)
    size = next
  }

  return {
    documentId: input.documentId,
    kind: input.kind,
    cursor,
    diagnostics: ordered.map((marker) => ({
      line: marker.startLineNumber,
      column: marker.startColumn,
      endLine: Math.max(marker.endLineNumber, marker.startLineNumber),
      endColumn: marker.endColumn,
      severity: marker.severity === SEVERITY_ERROR ? 'error' : 'warning',
      message: marker.message.slice(0, MAX_EDITOR_MESSAGE_CHARS),
    })),
    excerpt: { fromLine: from, toLine: to, text: kept.join('\n') },
  }
}
