import { inputRules } from 'prosemirror-inputrules'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { documentBodySchema } from './documentBody'
import { inlineMarkdownRules } from './markdownInputRules'
import { documentOf, paragraph, run } from './suggestionTestKit'

const views: EditorView[] = []
afterEach(() => views.splice(0).forEach((view) => view.destroy()))

/** An editor with one empty line and the inline rules, typing like a person. */
function editor(initial = '') {
  const doc = documentBodySchema.topNodeType.create(null, [
    documentOf(paragraph('p1', [run('r1', [initial || 'x'])])).firstChild!,
  ])
  const view = new EditorView(document.createElement('div'), {
    state: EditorState.create({
      doc,
      plugins: [inputRules({ rules: inlineMarkdownRules })],
    }),
  })
  views.push(view)
  // Start the caret at the end of the run text, then drop the placeholder.
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

/** The text as [text, marks] pieces. */
function pieces(view: EditorView) {
  const found: [string, string[]][] = []
  view.state.doc.descendants((node) => {
    if (node.isText)
      found.push([node.text!, node.marks.map((mark) => mark.type.name)])
  })
  return found
}

describe('inline Markdown rules', () => {
  it.each([
    ['**bold**', 'strong'],
    ['__bold__', 'strong'],
    ['*it*', 'em'],
    ['_it_', 'em'],
    ['~~gone~~', 'strike'],
    ['`code`', 'code'],
  ])('%s becomes %s, without its delimiters', (typed, mark) => {
    const view = editor()
    type(view, ` ${typed}`)

    const marked = pieces(view).filter(([, names]) => names.includes(mark))
    expect(marked).toHaveLength(1)
    expect(marked[0]![0]).toBe(typed.replace(/[*_~`]/g, ''))
    expect(view.state.doc.textContent).not.toMatch(/[*_~`]/)
  })

  it('what is typed after the marked text is plain', () => {
    const view = editor()
    type(view, ' **bold** after')

    expect(pieces(view).at(-1)).toEqual([' after', []])
  })

  it('does not fire for an unfinished delimiter, a spaced one, or an escaped one', () => {
    const view = editor()
    type(view, ' **bold* and ** spaced ** and \\*not*')

    expect(pieces(view).every(([, names]) => names.length === 0)).toBe(true)
  })

  it('[text](address) becomes a link on the text, and an unsafe address does not', () => {
    const view = editor()
    type(view, ' [docs](https://example.test/a)')
    expect(pieces(view).find(([, names]) => names.includes('link'))?.[0]).toBe(
      'docs'
    )

    const unsafe = editor()
    type(unsafe, ' [x](javascript:alert)')
    expect(pieces(unsafe).some(([, names]) => names.includes('link'))).toBe(
      false
    )
  })
})
