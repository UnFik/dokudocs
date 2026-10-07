import { TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { mountTestEditor } from './editorTestKit'
import { bodyBuilder } from './blocks/testSupport'
import { pressKey } from './editorTestKit'

function mountWith(type: string, attributes: Record<string, unknown> = {}) {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  b.add(root, type, '', attributes)
  const p = b.add(root, 'paragraph')
  b.add(p, 'run', 'after')
  return mountTestEditor(b.nodes)
}

function caretIntoFirstBlock(harness: ReturnType<typeof mountWith>) {
  const { view } = harness.editor
  const first = view.state.doc.child(0).child(0)
  const at = 2 + (first.isTextblock || first.type.name === 'table' ? 0 : 1)
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.near(view.state.doc.resolve(at), 1)
    )
  )
  view.focus()
}

describe('Backspace on the empty line of a block', () => {
  it.each([
    ['atx-heading', { level: 1 }, 'atx_heading'],
    ['code-block', { type: 'fenced', lang: '' }, 'code_block'],
    ['math-block', { mathStyle: 'double-dollar' }, 'math_block'],
  ])('removes an empty %s', async (type, attrs, pmName) => {
    const harness = mountWith(type, attrs)
    try {
      caretIntoFirstBlock(harness)
      pressKey(harness.editor.view.dom, 'Backspace')
      await new Promise((resolve) => setTimeout(resolve, 100))
      const names: string[] = []
      harness.editor.view.state.doc.child(0).forEach((n) => names.push(n.type.name))
      expect(names).not.toContain(pmName)
      expect(names).toContain('paragraph')
    } finally {
      harness.cleanup()
    }
  })
})
