import { AllSelection, TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { yUndoPluginKey } from 'y-prosemirror'
import * as Y from 'yjs'
import { draftSuggestion, type TypingDraft } from '../suggestion-draft'
import type { SuggestionDraft } from '../suggestion-operations'
import {
  mountTestEditor,
  paragraphsBody,
  pressKey,
  runStart,
} from './editorTestKit'

function suggestEditor(...texts: string[]) {
  const flushed: TypingDraft[] = []
  const operations: SuggestionDraft[] = []
  const refused: string[] = []
  const deletes: string[] = []
  const mounted = mountTestEditor(paragraphsBody(...texts), {
    onSuggestFlush: (draft) => {
      flushed.push(draft)
    },
    onSuggestRefused: (message) => refused.push(message),
    onSuggestOperations: (draft) => {
      operations.push(draft)
    },
    onDeleteNode: (nodeIDs) => {
      deletes.push(...nodeIDs)
    },
    suggestIdleMs: 0,
  })
  mounted.editor.setSuggestMode(true)
  const { view } = mounted.editor
  return {
    ...mounted,
    flushed,
    operations,
    refused,
    deletes,
    caret(text: string, offset: number) {
      const at = runStart(view.state.doc, text) + offset
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, at))
      )
    },
    select(text: string, from: number, to: number) {
      const start = runStart(view.state.doc, text)
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, start + from, start + to)
        )
      )
    },
    type(text: string) {
      for (const char of text) {
        const { from, to } = view.state.selection
        view.someProp('handleTextInput', (handle) =>
          handle(view, from, to, char, () => view.state.tr.insertText(char))
        )
      }
    },
    inserted: () =>
      [...mounted.host.querySelectorAll('.suggest-ins')].map(
        (node) => node.textContent
      ),
    struck: () =>
      [...mounted.host.querySelectorAll('.suggest-del')].map(
        (node) => node.textContent
      ),
  }
}

describe('suggest mode', () => {
  it('shows typed text in place without changing the body or Yjs', () => {
    const editor = suggestEditor('hello')
    try {
      const before = Y.encodeStateAsUpdate(editor.ydoc)
      editor.caret('hello', 5)
      editor.type(' world')
      expect(editor.inserted()).toEqual([' world'])
      expect(
        editor.editor.getBody().find((n) => n.nodeID === 'r0')?.content
      ).toBe('hello')
      expect(Y.encodeStateAsUpdate(editor.ydoc)).toEqual(before)
      expect(editor.flushed).toEqual([])
    } finally {
      editor.cleanup()
    }
  })

  it('saves consecutive typing as one suggestion when the caret moves away', () => {
    const editor = suggestEditor('hello', 'second')
    try {
      editor.caret('hello', 5)
      editor.type(' world')
      editor.caret('second', 0)
      expect(editor.flushed).toHaveLength(1)
      expect(draftSuggestion(editor.flushed[0]!)).toEqual({
        operations: [
          {
            op: 'replace_text',
            nodeID: 'r0',
            content: 'hello world',
            baseContent: 'hello',
          },
        ],
        summary: 'Insert “ world”',
      })
      // The saved suggestion stays drawn until the stored list catches up.
      expect(editor.inserted()).toEqual([' world'])
    } finally {
      editor.cleanup()
    }
  })

  it('splits suggestions when the caret moves between edits', () => {
    const editor = suggestEditor('hello')
    try {
      editor.caret('hello', 0)
      editor.type('A')
      editor.caret('hello', 5)
      editor.type('B')
      editor.editor.flushSuggestion()
      expect(
        editor.flushed.map((draft) => draftSuggestion(draft)?.summary)
      ).toEqual(['Insert “A”', 'Insert “B”'])
    } finally {
      editor.cleanup()
    }
  })

  it('turns Backspace then typing into one replace card with struck text', () => {
    const editor = suggestEditor('a cat')
    try {
      editor.caret('a cat', 5)
      for (let i = 0; i < 3; i++) pressKey(editor.editor.view.dom, 'Backspace')
      editor.type('dog')
      expect(editor.struck()).toEqual(['cat'])
      expect(editor.inserted()).toEqual(['dog'])
      editor.editor.flushSuggestion()
      expect(draftSuggestion(editor.flushed[0]!)?.summary).toBe(
        'Replace “cat” with “dog”'
      )
    } finally {
      editor.cleanup()
    }
  })

  it('drops a typed insertion that is deleted again before it is saved', () => {
    const editor = suggestEditor('hi')
    try {
      editor.caret('hi', 2)
      editor.type('!!')
      pressKey(editor.editor.view.dom, 'Backspace')
      pressKey(editor.editor.view.dom, 'Backspace')
      editor.editor.flushSuggestion()
      expect(editor.flushed).toEqual([])
      expect(editor.inserted()).toEqual([])
    } finally {
      editor.cleanup()
    }
  })

  it('continues the viewer’s own pending suggestion and withdraws it when emptied', () => {
    const editor = suggestEditor('hi')
    try {
      editor.editor.setSuggestionLayer([
        {
          suggestionID: 'mine',
          nodeID: 'r0',
          base: 'hi',
          text: 'hi!',
          own: true,
        },
      ])
      expect(editor.inserted()).toEqual(['!'])
      editor.caret('hi', 2)
      pressKey(editor.editor.view.dom, 'Backspace')
      expect(editor.inserted()).toEqual([])
      editor.editor.flushSuggestion()
      expect(editor.flushed).toHaveLength(1)
      expect(editor.flushed[0]!.replaces).toEqual(['mine'])
      expect(draftSuggestion(editor.flushed[0]!)).toBeNull()
    } finally {
      editor.cleanup()
    }
  })

  it('extends the viewer’s own pending suggestion instead of starting another', () => {
    const editor = suggestEditor('hi')
    try {
      editor.editor.setSuggestionLayer([
        {
          suggestionID: 'mine',
          nodeID: 'r0',
          base: 'hi',
          text: 'hi!',
          own: true,
        },
      ])
      editor.caret('hi', 2)
      editor.type('?')
      editor.editor.flushSuggestion()
      expect(editor.flushed[0]!.replaces).toEqual(['mine'])
      expect(draftSuggestion(editor.flushed[0]!)?.operations).toEqual([
        {
          op: 'replace_text',
          nodeID: 'r0',
          content: 'hi!?',
          baseContent: 'hi',
        },
      ])
    } finally {
      editor.cleanup()
    }
  })

  it('makes a separate suggestion when typing next to someone else’s', () => {
    const editor = suggestEditor('hi')
    try {
      editor.editor.setSuggestionLayer([
        {
          suggestionID: 'theirs',
          nodeID: 'r0',
          base: 'hi',
          text: 'hi!',
          own: false,
        },
      ])
      editor.caret('hi', 0)
      editor.type('O')
      editor.editor.flushSuggestion()
      expect(editor.flushed[0]!.replaces).toEqual([])
      expect(editor.host.querySelector('.suggest-other')?.textContent).toBe('!')
    } finally {
      editor.cleanup()
    }
  })

  it('turns a selected block deleted with Backspace into a text suggestion, not a DeleteNode', () => {
    const editor = suggestEditor('first', 'second')
    try {
      editor.select('second', 0, 6)
      pressKey(editor.editor.view.dom, 'Backspace')
      editor.editor.flushSuggestion()
      expect(editor.deletes).toEqual([])
      expect(editor.editor.getBody()).toHaveLength(5)
      expect(draftSuggestion(editor.flushed[0]!)?.operations).toEqual([
        { op: 'delete', nodeID: 'r1', baseContent: 'second' },
      ])
    } finally {
      editor.cleanup()
    }
  })

  it('turns a delete across blocks into one suggestion that deletes covered blocks and trims the ragged ends', () => {
    const editor = suggestEditor('first', 'middle', 'last')
    try {
      const { view } = editor.editor
      const from = runStart(view.state.doc, 'first') + 2
      const to = runStart(view.state.doc, 'last') + 2
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, from, to)
        )
      )
      pressKey(view.dom, 'Backspace')
      expect(editor.refused).toEqual([])
      expect(editor.deletes).toEqual([])
      expect(editor.operations).toHaveLength(1)
      expect(editor.operations[0]).toEqual({
        operations: [
          {
            op: 'replace_text',
            nodeID: 'r0',
            content: 'fi',
            baseContent: 'first',
          },
          { op: 'delete', nodeID: 'p1' },
          {
            op: 'replace_text',
            nodeID: 'r2',
            content: 'st',
            baseContent: 'last',
          },
        ],
        summary: 'Delete 1 block and selected text',
      })
      expect(editor.editor.getBody()).toHaveLength(7)
    } finally {
      editor.cleanup()
    }
  })

  it('turns select-all and Delete into a suggestion to delete every block', () => {
    const editor = suggestEditor('first', 'second')
    try {
      const { view } = editor.editor
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(
            view.state.doc,
            1,
            view.state.doc.content.size - 1
          )
        )
      )
      pressKey(view.dom, 'Delete')
      expect(editor.refused).toEqual([])
      expect(editor.operations[0]?.operations).toEqual([
        { op: 'delete', nodeID: 'p0' },
        { op: 'delete', nodeID: 'p1' },
      ])
      expect(editor.operations[0]?.summary).toBe('Delete 2 blocks')
      expect(editor.editor.getBody()).toHaveLength(5)
    } finally {
      editor.cleanup()
    }
  })

  it('suggests deleting every block for select-all and Delete', () => {
    const editor = suggestEditor('first', 'second')
    try {
      const { view } = editor.editor
      view.dispatch(
        view.state.tr.setSelection(new AllSelection(view.state.doc))
      )
      pressKey(view.dom, 'Delete')
      expect(editor.refused).toEqual([])
      expect(editor.operations[0]?.operations).toEqual([
        { op: 'delete', nodeID: 'p0' },
        { op: 'delete', nodeID: 'p1' },
      ])
    } finally {
      editor.cleanup()
    }
  })

  it('suggests deleting every block for a real Ctrl+A then Delete', async () => {
    const editor = suggestEditor('first', 'second')
    try {
      editor.editor.view.focus()
      await userEvent.keyboard('{Control>}a{/Control}{Delete}')
      expect(editor.refused).toEqual([])
      expect(editor.operations[0]?.operations).toEqual([
        { op: 'delete', nodeID: 'p0' },
        { op: 'delete', nodeID: 'p1' },
      ])
    } finally {
      editor.cleanup()
    }
  })

  it('refuses a block split from Enter without changing the body', () => {
    const editor = suggestEditor('hello')
    try {
      editor.caret('hello', 2)
      pressKey(editor.editor.view.dom, 'Enter')
      expect(editor.editor.getBody()).toHaveLength(3)
      expect(editor.refused).toHaveLength(1)
    } finally {
      editor.cleanup()
    }
  })

  it('refuses typing over a selection that spans two blocks', () => {
    const editor = suggestEditor('first', 'second')
    try {
      const { view } = editor.editor
      const from = runStart(view.state.doc, 'first') + 2
      const to = runStart(view.state.doc, 'second') + 2
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, from, to)
        )
      )
      editor.type('x')
      expect(editor.refused).toHaveLength(1)
      expect(editor.inserted()).toEqual([])
    } finally {
      editor.cleanup()
    }
  })

  it('ignores undo and redo shortcuts so the shared history is not rewritten', () => {
    const editor = suggestEditor('hello')
    try {
      const undoManager = yUndoPluginKey.getState(
        editor.editor.view.state
      )?.undoManager
      const undo = pressKey(editor.editor.view.dom, 'z', { ctrlKey: true })
      expect(undo.defaultPrevented).toBe(true)
      expect(undoManager?.canUndo()).toBe(false)
    } finally {
      editor.cleanup()
    }
  })

  it('applies remote changes while suggesting and saves a draft whose text moved on', () => {
    const editor = suggestEditor('hello')
    try {
      editor.caret('hello', 5)
      editor.type('!')
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
      editor.ydoc.transact(() => {
        firstText(editor.ydoc.getXmlFragment('body'))!.insert(0, '>')
      }, 'remote')
      expect(
        editor.editor.getBody().find((n) => n.nodeID === 'r0')?.content
      ).toBe('>hello')
      expect(editor.flushed).toHaveLength(1)
      expect(editor.flushed[0]!.runs[0]!.base).toBe('hello')
    } finally {
      editor.cleanup()
    }
  })

  it('saves the draft and edits normally again after leaving suggest mode', () => {
    const editor = suggestEditor('hello')
    try {
      editor.caret('hello', 5)
      editor.type('?')
      editor.editor.setSuggestMode(false)
      expect(editor.flushed).toHaveLength(1)
      const { view } = editor.editor
      view.dispatch(
        view.state.tr.insertText('!', runStart(view.state.doc, 'hello') + 5)
      )
      expect(
        editor.editor.getBody().find((n) => n.nodeID === 'r0')?.content
      ).toBe('hello!')
    } finally {
      editor.cleanup()
    }
  })
})
