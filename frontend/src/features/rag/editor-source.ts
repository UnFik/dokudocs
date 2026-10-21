import {
  buildEditorContext,
  type EditorContext,
  type EditorKind,
  type EditorMarker,
} from './editor-context'

type Reading = {
  kind: EditorKind
  source: string
  cursor: { line: number; column: number }
  markers: EditorMarker[]
}

const sources = new Map<string, Array<() => Reading>>()
const listeners = new Map<string, Set<(question: string) => void>>()

/**
 * Lets the chat read a source editor (DBML or Mermaid) as it is at the moment
 * a question is sent. The editor registers while it is open and calls the
 * returned function when it closes.
 */
export function registerEditorSource(
  documentId: string,
  read: () => Reading
): () => void {
  sources.set(documentId, [...(sources.get(documentId) ?? []), read])
  return () => {
    const rest = (sources.get(documentId) ?? []).filter((one) => one !== read)
    if (rest.length) sources.set(documentId, rest)
    else sources.delete(documentId)
  }
}

/** The newest open editor of the document as the server takes it, or nothing. */
export function readEditorContext(
  documentId: string
): EditorContext | undefined {
  const read = sources.get(documentId)?.at(-1)
  return read && buildEditorContext({ documentId, ...read() })
}

export function fixQuestion(error: { line: number; message: string }) {
  return `Fix the error at line ${error.line}: ${error.message}`
}

/** The chat of the document hears the errors the User asks to fix. */
export function onFixRequest(
  documentId: string,
  listen: (question: string) => void
): () => void {
  const set = listeners.get(documentId) ?? new Set()
  set.add(listen)
  listeners.set(documentId, set)
  return () => {
    set.delete(listen)
    if (!set.size) listeners.delete(documentId)
  }
}

export function requestFix(
  documentId: string,
  error: { line: number; message: string }
) {
  const question = fixQuestion(error)
  listeners.get(documentId)?.forEach((listen) => listen(question))
}
