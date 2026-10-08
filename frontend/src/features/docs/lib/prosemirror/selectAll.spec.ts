import { AllSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { mountTestEditor, paragraphsBody, pressKey } from './editorTestKit'

describe('select all', () => {
  it('selects the whole body with Ctrl+A when the editor is editable', () => {
    const { editor, cleanup } = mountTestEditor(paragraphsBody('one', 'two'))
    try {
      const event = pressKey(editor.view.dom, 'a', { ctrlKey: true })
      expect(event.defaultPrevented).toBe(true)
      expect(editor.view.state.selection).toBeInstanceOf(AllSelection)
    } finally {
      cleanup()
    }
  })

  it('selects only the editor text through selectAll, also when read-only', () => {
    const outside = document.createElement('p')
    outside.textContent = 'text outside the editor'
    document.body.append(outside)
    const { editor, cleanup } = mountTestEditor(paragraphsBody('one', 'two'), {
      readOnly: true,
    })
    try {
      editor.selectAll()
      const selected = window.getSelection()?.toString() ?? ''
      expect(selected).toContain('one')
      expect(selected).toContain('two')
      expect(selected).not.toContain('outside')
    } finally {
      cleanup()
      outside.remove()
    }
  })
})
