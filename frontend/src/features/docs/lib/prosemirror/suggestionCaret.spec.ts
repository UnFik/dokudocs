import { TextSelection } from 'prosemirror-state'
import { expect, it } from 'vitest'
import {
  mountTestEditor,
  paragraphsBody,
  pressKey,
  runStart,
} from './editorTestKit'
import { cardTitle } from './suggestionCards'
import { ME } from './suggestionTestKit'

it.each(['none', 'remote cursor', 'comments'] as const)(
  'keeps a browser caret move before selectionchange (refresh: %s)',
  (refresh) => {
    const { editor, cleanup } = mountTestEditor(
      paragraphsBody('Original phrase'),
      {
        suggestAuthor: ME,
      }
    )
    try {
      editor.setSuggestMode(true)
      const start = runStart(editor.view.state.doc, 'Original phrase')
      editor.view.dispatch(
        editor.view.state.tr.setSelection(
          TextSelection.create(editor.view.state.doc, start + 8)
        )
      )
      editor.view.focus()
      const text = document
        .createTreeWalker(editor.view.dom, NodeFilter.SHOW_TEXT)
        .nextNode()!
      // Native End moves the browser caret before selectionchange updates the editor.
      window.getSelection()!.collapse(text, text.textContent!.length)
      const anchor = editor.createAnchor(start + 1, start + 2)
      if (refresh === 'remote cursor')
        editor.setRemoteCursors([
          {
            connectionID: 'owner',
            userID: 'owner',
            name: 'Owner',
            color: '#0369a1',
            anchor: anchor.start,
            head: anchor.start,
          },
        ])
      if (refresh === 'comments') {
        const anchor = editor.createAnchor(start + 1, start + 2)
        editor.setComments([{ id: 'comment', anchor, resolved: false }])
      }
      pressKey(editor.view.dom, 'Enter')
      const { from, to } = editor.view.state.selection
      editor.view.someProp('handleTextInput', (handler) =>
        handler(editor.view, from, to, 'Second line', () =>
          editor.view.state.tr.insertText('Second line', from, to)
        )
      )
      expect(editor.getSuggestionCards().map(cardTitle)).toEqual([
        'Add: "Second line"',
      ])
    } finally {
      cleanup()
    }
  }
)

it('keeps a browser text selection when comment decorations refresh', () => {
  const { editor, cleanup } = mountTestEditor(paragraphsBody('Beta'))
  try {
    const start = runStart(editor.view.state.doc, 'Beta')
    editor.view.focus()
    const text = document
      .createTreeWalker(editor.view.dom, NodeFilter.SHOW_TEXT)
      .nextNode()!
    window.getSelection()!.setBaseAndExtent(text, 0, text, 4)
    const anchor = editor.createAnchor(start, start + 1)
    editor.setComments([{ id: 'comment', anchor, resolved: false }])
    expect(editor.view.state.selection.from).toBe(start)
    expect(editor.view.state.selection.to).toBe(start + 4)
  } finally {
    cleanup()
  }
})
