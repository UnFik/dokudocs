import { TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { yUndoPluginKey } from 'y-prosemirror'
import * as Y from 'yjs'
import type { TextEditTranslation } from '../suggestion-operations'
import {
  mountTestEditor,
  paragraphsBody,
  pressKey,
  runStart,
} from './editorTestKit'

function suggestEditor(...texts: string[]) {
  const results: TextEditTranslation[] = []
  const deletes: string[] = []
  const mounted = mountTestEditor(paragraphsBody(...texts), {
    onSuggestTransaction: (result) => results.push(result),
    onDeleteNode: (nodeIDs) => {
      deletes.push(...nodeIDs)
    },
  })
  mounted.editor.setSuggestMode(true)
  return { ...mounted, results, deletes }
}

describe('suggest mode', () => {
  it('turns typing inside a run into a text suggestion and leaves the body and Yjs untouched', () => {
    const { editor, ydoc, results, cleanup } = suggestEditor('hello')
    try {
      const before = Y.encodeStateAsUpdate(ydoc)
      editor.view.dispatch(
        editor.view.state.tr.insertText(
          ' world',
          runStart(editor.view.state.doc, 'hello') + 5
        )
      )
      expect(editor.getBody().find((n) => n.nodeID === 'r0')?.content).toBe(
        'hello'
      )
      expect(Y.encodeStateAsUpdate(ydoc)).toEqual(before)
      expect(results).toEqual([
        {
          ok: true,
          draft: {
            operations: [
              { op: 'replace_text', nodeID: 'r0', content: 'hello world' },
            ],
            summary: 'Insert “ world” in “hello”',
          },
        },
      ])
    } finally {
      cleanup()
    }
  })

  it('refuses a block split from Enter without changing the body', () => {
    const { editor, results, cleanup } = suggestEditor('hello')
    try {
      const at = runStart(editor.view.state.doc, 'hello') + 2
      editor.view.dispatch(
        editor.view.state.tr.setSelection(
          TextSelection.create(editor.view.state.doc, at)
        )
      )
      pressKey(editor.view.dom, 'Enter')
      expect(editor.getBody()).toHaveLength(3)
      expect(results).toHaveLength(1)
      expect(results[0]!.ok).toBe(false)
    } finally {
      cleanup()
    }
  })

  it('does not queue DeleteNode when a whole block is selected and Backspace is pressed', () => {
    const { editor, deletes, results, cleanup } = suggestEditor(
      'first',
      'second'
    )
    try {
      const start = runStart(editor.view.state.doc, 'second')
      editor.view.dispatch(
        editor.view.state.tr.setSelection(
          TextSelection.create(editor.view.state.doc, start, start + 6)
        )
      )
      pressKey(editor.view.dom, 'Backspace')
      expect(deletes).toEqual([])
      expect(editor.getBody()).toHaveLength(5)
      expect(results.every((result) => !result.ok)).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('ignores undo and redo shortcuts so the shared history is not rewritten', () => {
    const { editor, results, cleanup } = suggestEditor('hello')
    try {
      const undoManager = yUndoPluginKey.getState(
        editor.view.state
      )?.undoManager
      const undo = pressKey(editor.view.dom, 'z', { ctrlKey: true })
      expect(undo.defaultPrevented).toBe(true)
      expect(undoManager?.canUndo()).toBe(false)
      expect(results).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('applies remote changes while suggesting', () => {
    const { editor, ydoc, cleanup } = suggestEditor('hello')
    try {
      const firstText = (
        node: Y.XmlFragment | Y.XmlElement
      ): Y.XmlText | null => {
        for (const child of node.toArray()) {
          if (child instanceof Y.XmlText) return child
          const inner = firstText(child as Y.XmlElement)
          if (inner) return inner
        }
        return null
      }
      ydoc.transact(() => {
        firstText(ydoc.getXmlFragment('body'))!.insert(5, '!')
      }, 'remote')
      expect(editor.getBody().find((n) => n.nodeID === 'r0')?.content).toBe(
        'hello!'
      )
    } finally {
      cleanup()
    }
  })

  it('edits normally again after leaving suggest mode', () => {
    const { editor, cleanup } = suggestEditor('hello')
    try {
      editor.setSuggestMode(false)
      editor.view.dispatch(
        editor.view.state.tr.insertText(
          '!',
          runStart(editor.view.state.doc, 'hello') + 5
        )
      )
      expect(editor.getBody().find((n) => n.nodeID === 'r0')?.content).toBe(
        'hello!'
      )
    } finally {
      cleanup()
    }
  })
})
