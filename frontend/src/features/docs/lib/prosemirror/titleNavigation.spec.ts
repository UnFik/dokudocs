import { TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import {
  mountTestEditor,
  paragraphsBody,
  pressKey,
  runStart,
} from './editorTestKit'

function mount(onTitle: () => void) {
  return mountTestEditor(paragraphsBody('first', 'second'), {
    onNavigateToTitle: onTitle,
  })
}

function caretAt(
  harness: ReturnType<typeof mount>,
  text: string,
  offset: number
) {
  const { view } = harness.editor
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(
        view.state.doc,
        runStart(view.state.doc, text) + offset
      )
    )
  )
}

// The title is the first line of the page: Up from the very start of the text goes to it.
describe('arrow up from the start of the text', () => {
  it('goes to the title', () => {
    let calls = 0
    const harness = mount(() => calls++)
    try {
      caretAt(harness, 'first', 0)
      const event = pressKey(harness.editor.view.dom, 'ArrowUp')
      expect(calls).toBe(1)
      expect(event.defaultPrevented).toBe(true)
    } finally {
      harness.cleanup()
    }
  })

  it('stays in the text when the caret is further in', () => {
    let calls = 0
    const harness = mount(() => calls++)
    try {
      caretAt(harness, 'first', 2)
      pressKey(harness.editor.view.dom, 'ArrowUp')
      caretAt(harness, 'second', 0)
      pressKey(harness.editor.view.dom, 'ArrowUp')
      expect(calls).toBe(0)
    } finally {
      harness.cleanup()
    }
  })

  it('does not leave the text with a selection or a modifier held', () => {
    let calls = 0
    const harness = mount(() => calls++)
    try {
      caretAt(harness, 'first', 0)
      pressKey(harness.editor.view.dom, 'ArrowUp', { shiftKey: true })
      expect(calls).toBe(0)
    } finally {
      harness.cleanup()
    }
  })
})
