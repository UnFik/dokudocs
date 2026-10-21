import * as monaco from 'monaco-editor'
import type { EditorKind } from '@/features/rag/editor-context'
import { registerEditorSource, requestFix } from '@/features/rag/editor-source'

const FIX_COMMAND = 'dokudocs.fixWithAI'
const SEVERITY_WARNING = 4

const documents = new WeakMap<monaco.editor.ITextModel, string>()
let registered = false

/**
 * Adds "Fix with AI" to the quick fixes of an error or warning in a DBML or
 * Mermaid editor. It hands the error to the chat of the document the editor
 * is open on; an editor not bound to a document gets no action.
 */
export function registerFixWithAI() {
  if (registered) return
  registered = true
  monaco.editor.registerCommand(
    FIX_COMMAND,
    (_accessor, documentId: string, line: number, message: string) =>
      requestFix(documentId, { line, message })
  )
  const provider: monaco.languages.CodeActionProvider = {
    provideCodeActions(model, _range, context) {
      const documentId = documents.get(model)
      const actions = documentId
        ? context.markers
            .filter((marker) => marker.severity >= SEVERITY_WARNING)
            .map((marker) => ({
              title: 'Fix with AI',
              kind: 'quickfix',
              diagnostics: [marker],
              command: {
                id: FIX_COMMAND,
                title: 'Fix with AI',
                arguments: [documentId, marker.startLineNumber, marker.message],
              },
            }))
        : []
      return { actions, dispose() {} }
    },
  }
  monaco.languages.registerCodeActionProvider('dbml', provider)
  monaco.languages.registerCodeActionProvider('mermaid', provider)
}

/**
 * Lets the chat of a document read this editor's errors and cursor when a
 * question is sent, and lets Fix with AI find the document. Returns what to
 * call when the editor closes.
 */
export function bindEditorToChat(
  editor: monaco.editor.IStandaloneCodeEditor,
  documentId: string,
  kind: EditorKind
): () => void {
  const model = editor.getModel()
  if (!model) return () => {}
  registerFixWithAI()
  documents.set(model, documentId)
  const stop = registerEditorSource(documentId, () => {
    const position = editor.getPosition()
    return {
      kind,
      source: model.getValue(),
      cursor: {
        line: position?.lineNumber ?? 1,
        column: position?.column ?? 1,
      },
      markers: monaco.editor.getModelMarkers({ resource: model.uri }),
    }
  })
  return () => {
    stop()
    documents.delete(model)
  }
}
