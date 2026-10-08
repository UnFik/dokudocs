import { TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { outlineOf } from './outline'
import { mountTestEditor, paragraphsBody } from './prosemirror/editorTestKit'

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

describe('outline from the editor', () => {
  it('lists a heading made by the heading command', () => {
    const harness = mountTestEditor(paragraphsBody('Alpha title'))
    try {
      harness.editor.setHeading(2)
      expect(outlineOf(harness.editor.getBody())).toEqual([
        { nodeID: 'p0', level: 2, text: 'Alpha title' },
      ])
    } finally {
      harness.cleanup()
    }
  })

  it('lists a heading made by typing # and then its text', () => {
    const harness = mountTestEditor([
      ...paragraphsBody().slice(0, 1),
      {
        nodeID: 'p0',
        parentID: 'root',
        siblingOrder: 0,
        type: 'paragraph',
        content: '',
        attributes: {},
      },
    ])
    try {
      const { view } = harness.editor
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 2))
      )
      typeText(harness, '# Alpha title')
      expect(outlineOf(harness.editor.getBody()).map((item) => item.text)).toEqual([
        'Alpha title',
      ])
    } finally {
      harness.cleanup()
    }
  })
})
