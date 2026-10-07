import { inputRules } from 'prosemirror-inputrules'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { documentBodySchema } from './documentBody'
import { smartTextRules } from './smartText'
import { documentOf, paragraph, run } from './suggestionTestKit'

const views: EditorView[] = []
afterEach(() => views.splice(0).forEach((view) => view.destroy()))

function editor(enabled = true) {
  const doc = documentBodySchema.topNodeType.create(null, [
    documentOf(paragraph('p1', [run('r1', ['x'])])).firstChild!,
  ])
  const view = new EditorView(document.createElement('div'), {
    state: EditorState.create({
      doc,
      plugins: [inputRules({ rules: smartTextRules(() => enabled) })],
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
  return view
}

function type(view: EditorView, text: string) {
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

const text = (view: EditorView) => view.state.doc.textContent

describe('smart text', () => {
  it.each([
    ['...', '…'],
    ['->', '→'],
    ['<-', '←'],
    ['(c)', '©'],
    ['(tm)', '™'],
  ])('%s becomes %s', (typed, result) => {
    const view = editor()
    type(view, ` ${typed}`)
    expect(text(view)).toBe(`x ${result}`)
  })

  it('curls double and single quotes, and an apostrophe', () => {
    const view = editor()
    type(view, ` "hi" it's 'a'`)
    expect(text(view)).toBe('x “hi” it’s ‘a’')
  })

  it('does nothing when the preference is off', () => {
    const view = editor(false)
    type(view, ' ... -> "hi"')
    expect(text(view)).toBe('x ... -> "hi"')
  })

  it('leaves code alone', () => {
    const view = editor()
    const code = documentBodySchema.marks.code!
    view.dispatch(view.state.tr.addStoredMark(code.create()))
    type(view, ' ->')
    expect(text(view)).toBe('x ->')
  })
})
