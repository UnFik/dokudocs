import * as monaco from 'monaco-editor'
import { MonacoBinding } from 'y-monaco'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

/** Monaco bound to a DBML or Mermaid document's shared source text (ADR 0033). */
export type SourceBinding = {
  /** Undo and redo this person's edits only; someone else's never enter this history. */
  undo(): void
  redo(): void
  canUndo(): boolean
  canRedo(): boolean
  /** Ends the current undo step, so the next edit is undone on its own. */
  stopCapturing(): void
  /** Called when the undo history changes. Returns the function that stops it. */
  onHistoryChange(listener: () => void): () => void
  /**
   * Replaces the source with `next` as one undoable step, such as Format or a
   * template. Only the part that differs from the current source is rewritten,
   * so what others write elsewhere at the same time is kept.
   */
  replace(next: string): void
  destroy(): void
}

/**
 * Binds the editor's model to the shared text, with this person's selection
 * shared through awareness. The caller owns the editor and disposes it.
 */
export function bindSourceEditor(input: {
  text: Y.Text
  editor: monaco.editor.IStandaloneCodeEditor
  awareness?: Awareness | null
  readOnly?: boolean
}): SourceBinding {
  const { text, editor } = input
  const model = editor.getModel()
  if (!model) throw new Error('the editor has no model to bind')
  const doc = text.doc!
  // The shared source always has LF line endings; Monaco would otherwise count
  // offsets on its own line endings and drift from the text.
  model.setEOL(monaco.editor.EndOfLineSequence.LF)
  editor.updateOptions({ readOnly: Boolean(input.readOnly) })

  // y-monaco 0.1.6 never removes its selection listener; once destroyed, its
  // writes to awareness are dropped here.
  let alive = true
  const awareness = input.awareness
    ? new Proxy(input.awareness, {
        get(target, property) {
          if (property === 'setLocalStateField' && !alive) return () => {}
          const found = Reflect.get(target, property, target)
          return typeof found === 'function' ? found.bind(target) : found
        },
      })
    : null
  const binding = new MonacoBinding(text, model, new Set([editor]), awareness)

  // Format and templates write with this origin; typing writes with the binding's.
  const bulk = { name: 'source-replace' }
  const undoManager = new Y.UndoManager(text, {
    trackedOrigins: new Set<unknown>([binding, bulk]),
  })
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())
  undoManager.on('stack-item-added', notify)
  undoManager.on('stack-item-popped', notify)
  undoManager.on('stack-cleared', notify)

  // Undo through the shared history, not Monaco's, which would also hold remote edits.
  const actions = [
    editor.addAction({
      id: 'dokudocs.source.undo',
      label: 'Undo',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ],
      run: () => void undoManager.undo(),
    }),
    editor.addAction({
      id: 'dokudocs.source.redo',
      label: 'Redo',
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ,
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY,
      ],
      run: () => void undoManager.redo(),
    }),
  ]

  return {
    undo: () => void undoManager.undo(),
    redo: () => void undoManager.redo(),
    canUndo: () => undoManager.undoStack.length > 0,
    canRedo: () => undoManager.redoStack.length > 0,
    stopCapturing: () => undoManager.stopCapturing(),
    onHistoryChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    replace(next) {
      if (input.readOnly || !alive) return
      const target = next.replace(/\r\n?/g, '\n')
      const current = text.toString()
      if (target === current) return
      let start = 0
      const shortest = Math.min(current.length, target.length)
      while (start < shortest && current[start] === target[start]) start++
      let end = 0
      while (
        end < shortest - start &&
        current[current.length - 1 - end] === target[target.length - 1 - end]
      )
        end++
      undoManager.stopCapturing()
      doc.transact(() => {
        text.delete(start, current.length - start - end)
        text.insert(start, target.slice(start, target.length - end))
      }, bulk)
      undoManager.stopCapturing()
    },
    destroy() {
      if (!alive) return
      alive = false
      actions.forEach((action) => action.dispose())
      undoManager.destroy()
      listeners.clear()
      binding.destroy()
    },
  }
}
