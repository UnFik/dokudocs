import { describe, expect, it } from 'vitest'
import type { DocumentBodyNode } from '../documentBody'
import { mountTestEditor, paragraphsBody } from './editorTestKit'

function endingWithCode(): DocumentBodyNode[] {
  return [
    ...paragraphsBody('before'),
    {
      nodeID: 'code',
      parentID: 'root',
      siblingOrder: 5,
      type: 'code-block',
      content: 'const a = 1',
      attributes: { type: 'fenced', lang: 'ts' },
    },
  ]
}

type Harness = ReturnType<typeof mountTestEditor>
const types = (harness: Harness) => {
  const body = harness.editor.view.state.doc.child(0)
  return Array.from({ length: body.childCount }, (_, i) => body.child(i).type.name)
}
const strip = (harness: Harness) =>
  harness.host.querySelector<HTMLElement>('.dd-page-end')!
const click = (element: HTMLElement) =>
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }))

// Below the last block there is room to click, as in Outline: it puts the caret
// on a line there, adding a paragraph when the page ends in a block that has no
// text line (code block, table, list).
describe('clicking below the last block', () => {
  it('adds a paragraph after a code block and puts the caret in it', () => {
    const harness = mountTestEditor(endingWithCode())
    try {
      click(strip(harness))
      expect(types(harness).at(-1)).toBe('paragraph')
      const { $from } = harness.editor.view.state.selection
      expect($from.node($from.depth).type.name).toBe('paragraph')
    } finally {
      harness.cleanup()
    }
  })

  it('adds nothing when the page already ends in a paragraph', () => {
    const harness = mountTestEditor(paragraphsBody('one', 'two'))
    try {
      click(strip(harness))
      expect(types(harness)).toEqual(['paragraph', 'paragraph'])
    } finally {
      harness.cleanup()
    }
  })

  it('does not change a page that cannot be edited', () => {
    const harness = mountTestEditor(endingWithCode(), { readOnly: true })
    try {
      click(strip(harness))
      expect(types(harness).at(-1)).toBe('code_block')
    } finally {
      harness.cleanup()
    }
  })

  it('does not write in Suggest mode', () => {
    const harness = mountTestEditor(endingWithCode(), {
      suggestAuthor: '00000000-0000-4000-8000-0000000000a1',
    })
    try {
      harness.editor.setSuggestMode(true)
      click(strip(harness))
      expect(types(harness).at(-1)).toBe('code_block')
    } finally {
      harness.cleanup()
    }
  })
})
