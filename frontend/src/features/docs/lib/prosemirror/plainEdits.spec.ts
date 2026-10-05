import { describe, expect, it } from 'vitest'
import { prosemirrorToYDoc } from 'y-prosemirror'
import type { DocumentBodyNode } from '../documentBody'
import { createDocumentBodyEditor } from './createDocumentBodyEditor'
import { documentBodyToProseMirror } from './documentBody'

function bodyOf(...paragraphs: string[]): DocumentBodyNode[] {
  return [
    {
      nodeID: 'root',
      parentID: null,
      siblingOrder: 0,
      type: 'document',
      content: '',
      attributes: {},
    },
    ...paragraphs.map((content, index) => ({
      nodeID: `p${index}`,
      parentID: 'root',
      siblingOrder: index,
      type: 'paragraph',
      content,
      attributes: {},
    })),
  ]
}

function mountBody(...paragraphs: string[]) {
  const ydoc = prosemirrorToYDoc(
    documentBodyToProseMirror(bodyOf(...paragraphs)),
    'body'
  )
  const errors: unknown[] = []
  const editor = createDocumentBodyEditor(document.createElement('div'), ydoc, {
    onTransactionError: (error) => errors.push(error),
  })
  return { ydoc, editor, errors }
}

// With Hocuspocus the editor is the only writer: an ordinary delete or move is
// just an edit, with no separate command to wait for.
describe('plain edits through the collaborative editor', () => {
  it('deletes a block straight away', () => {
    const { ydoc, editor, errors } = mountBody('keep', 'remove this block')
    try {
      const second = editor.view.state.doc.child(0).child(1)
      const from = editor.view.state.doc.child(0).child(0).nodeSize + 1
      editor.view.dispatch(
        editor.view.state.tr.delete(from, from + second.nodeSize)
      )

      expect(errors).toEqual([])
      expect(editor.view.state.doc.textContent).toBe('keep')
      expect(ydoc.getXmlFragment('body').toString()).not.toContain('remove')
    } finally {
      editor.destroy()
      ydoc.destroy()
    }
  })

  it('moves a block straight away', () => {
    const { ydoc, editor, errors } = mountBody('first', 'second')
    try {
      const documentNode = editor.view.state.doc.child(0)
      const first = documentNode.child(0)
      const tr = editor.view.state.tr
        .delete(1, 1 + first.nodeSize)
        .insert(editor.view.state.doc.content.size - 1 - first.nodeSize, first)
      editor.view.dispatch(tr)

      expect(errors).toEqual([])
      expect(editor.view.state.doc.child(0).child(0).textContent).toBe('second')
      expect(editor.view.state.doc.child(0).child(1).textContent).toBe('first')
    } finally {
      editor.destroy()
      ydoc.destroy()
    }
  })
})
