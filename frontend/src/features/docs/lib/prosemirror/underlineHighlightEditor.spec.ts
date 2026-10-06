import { inputRules } from 'prosemirror-inputrules'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { documentBodySchema } from './documentBody'
import {
  mountTestEditor,
  paragraphsBody,
  pressKey,
  runStart,
} from './editorTestKit'
import { inlineMarkdownRules } from './markdownInputRules'
import { documentOf, paragraph, run } from './suggestionTestKit'

function select(harness: ReturnType<typeof mountTestEditor>, text: string) {
  const { view } = harness.editor
  const from = runStart(view.state.doc, text)
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(view.state.doc, from, from + text.length)
    )
  )
}

const attributesOfRun = (harness: ReturnType<typeof mountTestEditor>) =>
  harness.editor.getBody().find((node) => node.type === 'run')!.attributes

describe('underline and highlight in the editor', () => {
  it('toggle from the toolbar on the selected text', () => {
    const harness = mountTestEditor(paragraphsBody('words'))
    try {
      select(harness, 'words')
      harness.editor.toggleMark('underline')
      expect(attributesOfRun(harness)).toMatchObject({ underline: true })
      select(harness, 'words')
      harness.editor.toggleMark('highlight')
      expect(attributesOfRun(harness)).toMatchObject({
        underline: true,
        highlight: true,
      })
      select(harness, 'words')
      harness.editor.toggleMark('underline')
      expect(attributesOfRun(harness).underline).toBeUndefined()
    } finally {
      harness.cleanup()
    }
  })

  it('underline toggles with Ctrl+U', () => {
    const harness = mountTestEditor(paragraphsBody('words'))
    try {
      select(harness, 'words')
      pressKey(harness.editor.view.dom, 'u', { ctrlKey: true })
      expect(attributesOfRun(harness)).toMatchObject({ underline: true })
    } finally {
      harness.cleanup()
    }
  })

  it('show in the inline state the toolbar reads', () => {
    const harness = mountTestEditor(paragraphsBody('words'))
    try {
      select(harness, 'words')
      harness.editor.toggleMark('highlight')
      select(harness, 'words')
      expect(harness.editor.getInlineState().marks).toMatchObject({
        highlight: true,
        underline: false,
      })
    } finally {
      harness.cleanup()
    }
  })
})

const views: EditorView[] = []
afterEach(() => views.splice(0).forEach((view) => view.destroy()))

describe('==text== typed in a line', () => {
  it('becomes highlighted text without its delimiters', () => {
    const doc = documentBodySchema.topNodeType.create(null, [
      documentOf(paragraph('p1', [run('r1', ['x'])])).firstChild!,
    ])
    const view = new EditorView(document.createElement('div'), {
      state: EditorState.create({
        doc,
        plugins: [inputRules({ rules: inlineMarkdownRules })],
      }),
    })
    views.push(view)
    let at = 0
    view.state.doc.descendants((node, pos) => {
      if (node.isText) at = pos + node.nodeSize
    })
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, at))
    )
    for (const character of ' ==key==') {
      const { from, to } = view.state.selection
      const handled = view.someProp('handleTextInput', (handler) =>
        handler(view, from, to, character, () =>
          view.state.tr.insertText(character, from, to)
        )
      )
      if (!handled) view.dispatch(view.state.tr.insertText(character, from, to))
    }
    const marked: string[] = []
    view.state.doc.descendants((node) => {
      if (
        node.isText &&
        node.marks.some((mark) => mark.type.name === 'highlight')
      )
        marked.push(node.text!)
    })
    expect(marked).toEqual(['key'])
    expect(view.state.doc.textContent).toBe('x key')
  })
})

describe('Ctrl+U with a real keyboard', () => {
  it('underlines the selected text', async () => {
    const { userEvent } = await import('vitest/browser')
    const harness = mountTestEditor(paragraphsBody('words'))
    try {
      select(harness, 'words')
      harness.editor.view.focus()
      await userEvent.keyboard('{Control>}u{/Control}')
      expect(attributesOfRun(harness)).toMatchObject({ underline: true })
    } finally {
      harness.cleanup()
    }
  })
})
