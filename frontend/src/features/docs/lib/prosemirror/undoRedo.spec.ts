import { describe, expect, it } from 'vitest'
import { yUndoPluginKey } from 'y-prosemirror'
import * as Y from 'yjs'
import {
  mountTestEditor,
  paragraphsBody,
  pressKey,
  runStart,
} from './editorTestKit'

function runTexts(editor: {
  getBody: () => { type: string; content: string }[]
}) {
  return editor
    .getBody()
    .filter((node) => node.type === 'run')
    .map((node) => node.content)
}

function stopCapturing(editor: { view: { state: never } }) {
  yUndoPluginKey.getState(editor.view.state)?.undoManager.stopCapturing()
}

describe('undo and redo', () => {
  it('undoes with Ctrl+Z and redoes with Ctrl+Shift+Z and Ctrl+Y', () => {
    const { editor, cleanup } = mountTestEditor(paragraphsBody('hello'))
    try {
      editor.view.dispatch(
        editor.view.state.tr.insertText(
          ' world',
          runStart(editor.view.state.doc, 'hello') + 5
        )
      )
      expect(runTexts(editor)).toEqual(['hello world'])

      const undo = pressKey(editor.view.dom, 'z', { ctrlKey: true })
      expect(undo.defaultPrevented).toBe(true)
      expect(runTexts(editor)).toEqual(['hello'])

      pressKey(editor.view.dom, 'z', { ctrlKey: true, shiftKey: true })
      expect(runTexts(editor)).toEqual(['hello world'])

      pressKey(editor.view.dom, 'z', { ctrlKey: true })
      expect(runTexts(editor)).toEqual(['hello'])
      pressKey(editor.view.dom, 'y', { ctrlKey: true })
      expect(runTexts(editor)).toEqual(['hello world'])
    } finally {
      cleanup()
    }
  })

  it('accepts the Cmd modifier', () => {
    const { editor, cleanup } = mountTestEditor(paragraphsBody('hello'))
    try {
      editor.view.dispatch(
        editor.view.state.tr.insertText(
          '!',
          runStart(editor.view.state.doc, 'hello') + 5
        )
      )
      pressKey(editor.view.dom, 'z', { metaKey: true })
      expect(runTexts(editor)).toEqual(['hello'])
    } finally {
      cleanup()
    }
  })

  it('reports whether undo and redo are available', () => {
    const seen: { canUndo: boolean; canRedo: boolean }[] = []
    const { editor, cleanup } = mountTestEditor(paragraphsBody('hello'), {
      onHistoryChange: (history) => seen.push(history),
    })
    try {
      expect(editor.getHistory()).toEqual({ canUndo: false, canRedo: false })
      editor.view.dispatch(
        editor.view.state.tr.insertText(
          '!',
          runStart(editor.view.state.doc, 'hello') + 5
        )
      )
      expect(editor.getHistory()).toEqual({ canUndo: true, canRedo: false })
      editor.undo()
      expect(editor.getHistory()).toEqual({ canUndo: false, canRedo: true })
      editor.redo()
      expect(editor.getHistory()).toEqual({ canUndo: true, canRedo: false })
      expect(seen.at(-1)).toEqual({ canUndo: true, canRedo: false })
      expect(seen).toContainEqual({ canUndo: false, canRedo: true })
    } finally {
      cleanup()
    }
  })

  it('does nothing while the editor is read-only', () => {
    const { editor, cleanup } = mountTestEditor(paragraphsBody('hello'))
    try {
      editor.view.dispatch(
        editor.view.state.tr.insertText(
          '!',
          runStart(editor.view.state.doc, 'hello') + 5
        )
      )
      editor.setReadOnly(true)
      expect(editor.undo()).toBe(false)
      pressKey(editor.view.dom, 'z', { ctrlKey: true })
      expect(runTexts(editor)).toEqual(['hello!'])
    } finally {
      cleanup()
    }
  })

  it('undo only reverts the local user edit, never the peer edit', () => {
    const first = mountTestEditor(paragraphsBody('alpha', 'beta'))
    const secondDoc = new Y.Doc()
    Y.applyUpdate(secondDoc, Y.encodeStateAsUpdate(first.ydoc))
    const second = mountTestEditor([], {}, secondDoc)
    first.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'remote') Y.applyUpdate(secondDoc, update, 'remote')
    })
    secondDoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'remote') Y.applyUpdate(first.ydoc, update, 'remote')
    })
    try {
      first.editor.view.dispatch(
        first.editor.view.state.tr.insertText(
          ' one',
          runStart(first.editor.view.state.doc, 'alpha') + 5
        )
      )
      stopCapturing(first.editor as never)
      second.editor.view.dispatch(
        second.editor.view.state.tr.insertText(
          ' two',
          runStart(second.editor.view.state.doc, 'beta') + 4
        )
      )
      expect(runTexts(first.editor)).toEqual(['alpha one', 'beta two'])

      pressKey(first.editor.view.dom, 'z', { ctrlKey: true })
      expect(runTexts(first.editor)).toEqual(['alpha', 'beta two'])
      expect(runTexts(second.editor)).toEqual(['alpha', 'beta two'])
      expect(first.editor.getHistory().canUndo).toBe(false)

      pressKey(second.editor.view.dom, 'z', { ctrlKey: true })
      expect(runTexts(first.editor)).toEqual(['alpha', 'beta'])
      expect(runTexts(second.editor)).toEqual(['alpha', 'beta'])
    } finally {
      first.cleanup()
      second.cleanup()
    }
  })
})
