import { TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { mountTestEditor, paragraphsBody, runStart } from './editorTestKit'

const ME = '00000000-0000-4000-8000-0000000000a1'

function editorWith(...texts: string[]) {
  const clicked: string[] = []
  const mounted = mountTestEditor(paragraphsBody(...texts), {
    suggestAuthor: ME,
    onCommentClick: (id) => clicked.push(id),
  })
  const { view } = mounted.editor
  const comment = (text: string, from: number, to: number) => {
    const start = runStart(view.state.doc, text)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start + from, start + to)))
    const draft = mounted.editor.getCommentDraft()
    if (!draft.ok) throw new Error('no draft')
    return draft.anchor
  }
  return { ...mounted, comment, clicked }
}

const markers = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLButtonElement>('.dd-comment-gutter')]

// A line that has an open comment shows it in the margin, as Outline does.
describe('comment indicator in the margin', () => {
  it('shows one marker on each line that has an open comment, named by their number', () => {
    const editor = editorWith('first line here', 'second line here', 'third')
    try {
      const a = editor.comment('first line here', 0, 5)
      const b = editor.comment('first line here', 6, 10)
      const c = editor.comment('third', 0, 3)
      editor.editor.setComments([
        { id: 't1', anchor: a, resolved: false },
        { id: 't2', anchor: b, resolved: false },
        { id: 't3', anchor: c, resolved: false },
      ])
      const found = markers(editor.host)
      expect(found).toHaveLength(2)
      expect(found.map((marker) => marker.getAttribute('aria-label'))).toEqual([
        '2 comments on this line',
        '1 comment on this line',
      ])
    } finally {
      editor.cleanup()
    }
  })

  it('leaves out resolved threads', () => {
    const editor = editorWith('only line')
    try {
      const anchor = editor.comment('only line', 0, 4)
      editor.editor.setComments([{ id: 't1', anchor, resolved: true }])
      expect(markers(editor.host)).toHaveLength(0)
    } finally {
      editor.cleanup()
    }
  })

  it('opens the first thread of the line when clicked, and adds no text to the page', () => {
    const editor = editorWith('only line')
    try {
      const anchor = editor.comment('only line', 0, 4)
      editor.editor.setComments([{ id: 't9', anchor, resolved: false }])
      markers(editor.host)[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(editor.clicked).toEqual(['t9'])
      expect(editor.host.querySelector('p')?.textContent).toBe('only line')
    } finally {
      editor.cleanup()
    }
  })
})
