import { TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { mountTestEditor, paragraphsBody, runStart } from './editorTestKit'

// Comment threads are marked in the editor from anchors, and follow their words.

const ME = '00000000-0000-4000-8000-0000000000a1'

function commentEditor(...texts: string[]) {
  let positions: Record<string, number | null> = {}
  const clicked: string[] = []
  const mounted = mountTestEditor(paragraphsBody(...texts), {
    suggestAuthor: ME,
    onCommentPositions: (next) => {
      positions = next
    },
    onCommentClick: (id) => clicked.push(id),
  })
  const { view } = mounted.editor
  view.focus()
  return {
    ...mounted,
    positions: () => positions,
    clicked,
    select(text: string, from: number, to: number) {
      const start = runStart(view.state.doc, text)
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, start + from, start + to)
        )
      )
    },
    marked: () =>
      [...mounted.host.querySelectorAll('[data-comment-id]')].map(
        (node) => node.textContent
      ),
  }
}

describe('comment marks', () => {
  it('marks the commented words and follows them when text is typed before them', async () => {
    const editor = commentEditor('hello world')
    try {
      editor.select('hello world', 6, 11)
      const draft = editor.editor.getCommentDraft()
      expect(draft.ok && draft.selectedText).toBe('world')
      if (!draft.ok) return
      editor.editor.setComments([
        { id: 't1', anchor: draft.anchor, resolved: false },
      ])
      expect(editor.marked()).toEqual(['world'])
      const before = editor.positions().t1!

      editor.select('hello world', 0, 0)
      await userEvent.keyboard('XY')

      expect(editor.marked()).toEqual(['world'])
      expect(editor.positions().t1).toBe(before + 2)
    } finally {
      editor.cleanup()
    }
  })

  it('does not mark a resolved thread but still places it', () => {
    const editor = commentEditor('hello world')
    try {
      editor.select('hello world', 0, 5)
      const draft = editor.editor.getCommentDraft()
      if (!draft.ok) throw new Error('no draft')
      editor.editor.setComments([
        { id: 't1', anchor: draft.anchor, resolved: true },
      ])

      expect(editor.marked()).toEqual([])
      expect(editor.positions().t1).not.toBeNull()
    } finally {
      editor.cleanup()
    }
  })

  it('reports a thread whose text is gone as orphaned, and one with no anchor too', async () => {
    const editor = commentEditor('hello world')
    try {
      editor.select('hello world', 6, 11)
      const draft = editor.editor.getCommentDraft()
      if (!draft.ok) throw new Error('no draft')
      editor.editor.setComments([
        { id: 't1', anchor: draft.anchor, resolved: false },
        { id: 't2', anchor: null, resolved: false },
      ])
      expect(editor.positions().t2).toBeNull()

      editor.select('hello world', 5, 11)
      editor.editor.view.focus()
      await userEvent.keyboard('{Delete}')

      expect(editor.positions().t1).toBeNull()
      expect(editor.marked()).toEqual([])
    } finally {
      editor.cleanup()
    }
  })

  it('tells the caller which thread was clicked and focuses it on request', async () => {
    const editor = commentEditor('hello world')
    try {
      editor.select('hello world', 0, 5)
      const draft = editor.editor.getCommentDraft()
      if (!draft.ok) throw new Error('no draft')
      editor.editor.setComments([
        { id: 't1', anchor: draft.anchor, resolved: false },
      ])

      await userEvent.click(
        editor.host.querySelector<HTMLElement>('[data-comment-id="t1"]')!
      )
      expect(editor.clicked).toEqual(['t1'])

      expect(editor.editor.scrollToComment('t1')).toBe(true)
      expect(editor.host.querySelector('.comment-focus')).not.toBeNull()
      editor.editor.setFocusedComment(null)
      expect(editor.host.querySelector('.comment-focus')).toBeNull()
      expect(editor.editor.scrollToComment('nope')).toBe(false)
    } finally {
      editor.cleanup()
    }
  })

  it('offers no draft for an empty selection or one across paragraphs', () => {
    const editor = commentEditor('one', 'two')
    try {
      editor.select('one', 1, 1)
      expect(editor.editor.getCommentDraft().ok).toBe(false)

      const { view } = editor.editor
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(
            view.state.doc,
            runStart(view.state.doc, 'one') + 1,
            runStart(view.state.doc, 'two') + 2
          )
        )
      )
      expect(editor.editor.getCommentDraft().ok).toBe(false)
    } finally {
      editor.cleanup()
    }
  })
})
