import { describe, expect, it } from 'vitest'
import { mountTestEditor, paragraphsBody, runStart } from './editorTestKit'
import { TextSelection } from 'prosemirror-state'

function typeAtEnd(harness: ReturnType<typeof mountTestEditor>, text: string) {
  const { view } = harness.editor
  const at = runStart(view.state.doc, 'ten chars!') + 'ten chars!'.length
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)))
  view.dispatch(view.state.tr.insertText(text, at))
}

// A page may hold only so much text; past that, typing and pasting are refused,
// while deleting still works.
describe('the most a page may hold', () => {
  it('refuses text that would go past the limit', () => {
    const harness = mountTestEditor(paragraphsBody('ten chars!'), { maxCharacters: 12 })
    try {
      typeAtEnd(harness, 'abc')
      expect(harness.editor.view.state.doc.textContent).toBe('ten chars!')
    } finally {
      harness.cleanup()
    }
  })

  it('accepts text up to the limit', () => {
    const harness = mountTestEditor(paragraphsBody('ten chars!'), { maxCharacters: 12 })
    try {
      typeAtEnd(harness, 'ab')
      expect(harness.editor.view.state.doc.textContent).toBe('ten chars!ab')
    } finally {
      harness.cleanup()
    }
  })

  it('still lets text be deleted when the page is full', () => {
    const harness = mountTestEditor(paragraphsBody('ten chars!'), { maxCharacters: 5 })
    try {
      const { view } = harness.editor
      const from = runStart(view.state.doc, 'ten chars!')
      view.dispatch(view.state.tr.delete(from, from + 4))
      expect(view.state.doc.textContent).toBe('chars!')
    } finally {
      harness.cleanup()
    }
  })

  it('has no limit unless one is given', () => {
    const harness = mountTestEditor(paragraphsBody('ten chars!'))
    try {
      typeAtEnd(harness, ' and a lot more text than that')
      expect(harness.editor.view.state.doc.textContent.length).toBeGreaterThan(30)
    } finally {
      harness.cleanup()
    }
  })
})
