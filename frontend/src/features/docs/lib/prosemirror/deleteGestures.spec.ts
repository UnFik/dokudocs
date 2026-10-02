import { NodeSelection, TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import type { DocumentBodyNode } from '../documentBody'
import { mountTestEditor, paragraphsBody } from './editorTestKit'

// Real key presses on a focused editor: the browser's own deletion is ignored
// for selections that cross blocks, so these gestures are handled explicitly.

function withSeparator(): DocumentBodyNode[] {
  return [
    ...paragraphsBody('first', 'second'),
    {
      nodeID: 'hr',
      parentID: 'root',
      siblingOrder: 2,
      type: 'thematic-break',
      content: '',
      attributes: {},
    },
    {
      nodeID: 'p9',
      parentID: 'root',
      siblingOrder: 3,
      type: 'paragraph',
      content: '',
      attributes: {},
    },
    {
      nodeID: 'r9',
      parentID: 'p9',
      siblingOrder: 0,
      type: 'run',
      content: 'after',
      attributes: {},
    },
  ]
}

function mount(body: DocumentBodyNode[]) {
  const batches: string[][] = []
  const errors: unknown[] = []
  const mounted = mountTestEditor(body, {
    onDeleteNode: (nodeIDs) => {
      batches.push(nodeIDs)
    },
    onTransactionError: (error) => errors.push(error),
  })
  mounted.editor.view.focus()
  const runStart = (text: string) => {
    let found = -1
    mounted.editor.view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'run' && node.textContent === text) found = pos + 1
      return found < 0
    })
    return found
  }
  return { ...mounted, batches, errors, runStart }
}

describe('delete gestures with a real keyboard', () => {
  for (const key of ['Delete', 'Backspace']) {
    it(`Ctrl+A then ${key} deletes every block as one batch`, async () => {
      const { editor, batches, errors, cleanup } = mount(
        paragraphsBody('a', 'b', 'c')
      )
      try {
        await userEvent.keyboard(`{Control>}a{/Control}{${key}}`)
        expect(errors).toEqual([])
        expect(batches).toEqual([['p0', 'p1', 'p2']])
        // Nothing changes locally; the canonical body arrives with the new epoch.
        expect(editor.getBody()).toHaveLength(7)
      } finally {
        cleanup()
      }
    })
  }

  it('deletes a selected separator', async () => {
    const { editor, batches, errors, cleanup } = mount(withSeparator())
    try {
      const { view } = editor
      let separator = -1
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'thematic_break') separator = pos
        return separator < 0
      })
      view.dispatch(
        view.state.tr.setSelection(
          NodeSelection.create(view.state.doc, separator)
        )
      )
      await userEvent.keyboard('{Delete}')
      expect(errors).toEqual([])
      expect(batches).toEqual([['hr']])
    } finally {
      cleanup()
    }
  })

  it('deletes a separator with Delete from the end of the paragraph before it', async () => {
    const { editor, batches, errors, runStart, cleanup } =
      mount(withSeparator())
    try {
      const { view } = editor
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, runStart('second') + 6)
        )
      )
      await userEvent.keyboard('{Delete}')
      expect(errors).toEqual([])
      expect(batches).toEqual([['hr']])
    } finally {
      cleanup()
    }
  })

  it('trims the text at both ends and deletes the separator between when text across blocks is deleted', async () => {
    const { editor, batches, errors, runStart, cleanup } =
      mount(withSeparator())
    try {
      const { view } = editor
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(
            view.state.doc,
            runStart('second') + 3,
            runStart('after') + 2
          )
        )
      )
      await userEvent.keyboard('{Backspace}')
      expect(errors).toEqual([])
      expect(batches).toEqual([['hr']])
      expect(editor.getBody().map((node) => node.content)).toContain('sec')
      expect(editor.getBody().map((node) => node.content)).toContain('ter')
    } finally {
      cleanup()
    }
  })

  it('leaves a delete inside one paragraph to the browser', async () => {
    const { editor, batches, errors, runStart, cleanup } = mount(
      paragraphsBody('hello', 'world')
    )
    try {
      const { view } = editor
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(
            view.state.doc,
            runStart('hello') + 1,
            runStart('hello') + 3
          )
        )
      )
      await userEvent.keyboard('{Backspace}')
      expect(errors).toEqual([])
      expect(batches).toEqual([])
      expect(
        editor.getBody().find((node) => node.nodeID === 'r0')?.content
      ).toBe('hlo')
    } finally {
      cleanup()
    }
  })
})
