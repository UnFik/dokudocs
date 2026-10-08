import { TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import {
  mountTestEditor,
  paragraphsBody,
  pressKey,
  runStart,
} from './editorTestKit'

type Harness = ReturnType<typeof mountTestEditor>

function typeText(harness: Harness, text: string) {
  const { view } = harness.editor
  for (const character of text) {
    const { from, to } = view.state.selection
    const handled = view.someProp('handleTextInput', (handler) =>
      handler(view, from, to, character, () =>
        view.state.tr.insertText(character, from, to)
      )
    )
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to))
  }
}

function endOf(harness: Harness, text: string) {
  const { view } = harness.editor
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(
        view.state.doc,
        runStart(view.state.doc, text) + text.length
      )
    )
  )
}

const types = (harness: Harness) =>
  harness.editor.getBody().map((node) => node.type)

// Backspace right after a Markdown rule turned the line into a block gives the
// typed characters back, as in Outline.
describe('Backspace right after a Markdown rule', () => {
  it.each([
    ['# ', 'atx-heading'],
    ['- ', 'bullet-list'],
    ['1. ', 'order-list'],
    ['> ', 'block-quote'],
  ])(
    'undoes %s, leaving a paragraph with the typed text',
    async (typed, block) => {
      const harness = mountTestEditor(paragraphsBody(typed.trim()))
      try {
        endOf(harness, typed.trim())
        typeText(harness, ' ')
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(types(harness)).toContain(block)

        pressKey(harness.editor.view.dom, 'Backspace')
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(types(harness)).not.toContain(block)
        expect(types(harness)).toContain('paragraph')
        expect(harness.editor.view.state.doc.textContent).toBe(typed)
      } finally {
        harness.cleanup()
      }
    }
  )

  it('does nothing special once something else was typed', async () => {
    const harness = mountTestEditor(paragraphsBody('#'))
    try {
      endOf(harness, '#')
      typeText(harness, ' ')
      typeText(harness, 'A')
      pressKey(harness.editor.view.dom, 'Backspace')
      expect(types(harness)).toContain('atx-heading')
    } finally {
      harness.cleanup()
    }
  })
})
