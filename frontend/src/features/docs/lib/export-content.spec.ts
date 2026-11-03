import { TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { documentBodyToMarkdown } from './muya/state/documentBodyToMarkdown'
import { prosemirrorToDocumentBody } from './prosemirror/documentBody'
import {
  mountTestEditor,
  paragraphsBody,
  runStart,
} from './prosemirror/editorTestKit'
import { suggestionFixtureDoc } from './prosemirror/suggestionFixture'

// Every export format starts from the Markdown the editor builds from its body, so
// this is where "only canonical content is exported" is decided.

describe('the Markdown a person exports', () => {
  it('holds no pending suggestion: not an insert, a restyle, or a proposed block', () => {
    const markdown = documentBodyToMarkdown(
      prosemirrorToDocumentBody(suggestionFixtureDoc())
    )

    expect(markdown).toContain('Hello world')
    expect(markdown).toContain('Keep drop and restyle')
    expect(markdown).toContain('block to delete')
    expect(markdown).not.toContain('big')
    expect(markdown).not.toContain('inserted block')
    expect(markdown).not.toContain('**')
  })

  it('shows a commented passage as plain text, with no mark of the thread', () => {
    const mounted = mountTestEditor(paragraphsBody('hello world'), {
      suggestAuthor: '00000000-0000-4000-8000-0000000000a1',
      onCommentPositions: () => {},
    })
    try {
      const { view } = mounted.editor
      const start = runStart(view.state.doc, 'hello world')
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, start + 6, start + 11)
        )
      )
      const draft = mounted.editor.getCommentDraft()
      if (!draft.ok) throw new Error('no comment draft')
      mounted.editor.setComments([
        { id: 't1', anchor: draft.anchor, resolved: false },
      ])
      expect(mounted.host.querySelector('[data-comment-id]')).not.toBeNull()

      const markdown = documentBodyToMarkdown(mounted.editor.getBody())

      expect(markdown.trim()).toBe('hello world')
    } finally {
      mounted.cleanup()
    }
  })
})
