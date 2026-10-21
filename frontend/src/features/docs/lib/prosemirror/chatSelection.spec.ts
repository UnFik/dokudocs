import { TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { mountTestEditor, paragraphsBody } from './editorTestKit'

// The text a reader selected goes to the chat as it reads, with a break between blocks.

function chatEditor(texts: string[], onAddToChatRequest?: () => void) {
  const mounted = mountTestEditor(paragraphsBody(...texts), {
    onAddToChatRequest,
  })
  const { view } = mounted.editor
  view.focus()
  return {
    ...mounted,
    selectAll() {
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(
            view.state.doc,
            1,
            view.state.doc.content.size - 1
          )
        )
      )
    },
    caretAtStart() {
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 1))
      )
    },
  }
}

describe('selection for the chat', () => {
  it('is the selected words, one block per line', () => {
    const editor = chatEditor(['first block', 'second block'])
    try {
      editor.selectAll()
      expect(editor.editor.getSelectedText()).toBe('first block\nsecond block')
    } finally {
      editor.cleanup()
    }
  })

  it('is empty with only a caret', () => {
    const editor = chatEditor(['first block'])
    try {
      editor.caretAtStart()
      expect(editor.editor.getSelectedText()).toBe('')
    } finally {
      editor.cleanup()
    }
  })

  it('is asked for with Ctrl+Alt+L', async () => {
    let asked = 0
    const editor = chatEditor(['first block'], () => asked++)
    try {
      await userEvent.keyboard('{Control>}{Alt>}l{/Alt}{/Control}')
      expect(asked).toBe(1)
    } finally {
      editor.cleanup()
    }
  })
})
