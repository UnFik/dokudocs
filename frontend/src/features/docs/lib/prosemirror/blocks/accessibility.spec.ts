import { TextSelection } from 'prosemirror-state'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { prosemirrorToYDoc } from 'y-prosemirror'
import { createDocumentBodyEditor } from '../createDocumentBodyEditor'
import { documentBodyToProseMirror } from '../documentBody'
import { blockEditing } from './index'
import { bodyBuilder, bodyOf } from './testSupport'

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn())
  document.body.replaceChildren()
})

function mountEditor(text: string) {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  const p = b.add(root, 'paragraph')
  const run = text ? b.add(p, 'run', text) : ''
  const ydoc = prosemirrorToYDoc(documentBodyToProseMirror(b.nodes), 'body')
  const host = document.createElement('div')
  document.body.append(host)
  const errors: unknown[] = []
  const blocks = blockEditing()
  const editor = createDocumentBodyEditor(host, ydoc, {
    plugins: blocks.plugins,
    nodeViews: blocks.nodeViews,
    onEditorReady: blocks.attach,
    onTransactionError: (e) => errors.push(e),
  })
  cleanups.push(() => {
    editor.destroy()
    ydoc.destroy()
  })
  return { editor, host, errors, run, p }
}

describe('IME composition', () => {
  it('keeps the run and its node ID when composed text is committed', async () => {
    const { editor, errors, run } = mountEditor('ab')
    const { view } = editor
    view.focus()
    const textNode = view.dom.querySelector('span')!.firstChild as Text
    const end = view.posAtDOM(textNode, 2)
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, end))
    )

    view.dom.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true })
    )
    textNode.nodeValue = 'abか'
    view.dom.dispatchEvent(
      new CompositionEvent('compositionupdate', { data: 'か', bubbles: true })
    )
    textNode.nodeValue = 'abかな'
    view.dom.dispatchEvent(
      new CompositionEvent('compositionend', { data: 'かな', bubbles: true })
    )
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(errors).toEqual([])
    const runs = bodyOf(view.state.doc).filter((n) => n.type === 'run')
    expect(runs.map((n) => n.content).join('')).toBe('abかな')
    expect(runs.some((n) => n.nodeID === run)).toBe(true)
  })

  it('does not open the block menu for a slash typed during composition', () => {
    const { editor, host } = mountEditor('')
    editor.view.focus()
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '/',
        isComposing: true,
        bubbles: true,
      })
    )
    expect(host.querySelector('[role="combobox"]')).toBeNull()
  })
})

describe('phone width', () => {
  it('keeps the slash menu inside the editor width', async () => {
    await page.viewport(375, 700)
    const { editor, host } = mountEditor('')
    host.style.width = '375px'
    editor.view.focus()
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '/',
        bubbles: true,
        cancelable: true,
      })
    )
    const menu = host.querySelector<HTMLElement>('.dd-slash')!
    const rect = menu.getBoundingClientRect()
    expect(rect.right).toBeLessThanOrEqual(375)
    expect(rect.left).toBeGreaterThanOrEqual(0)
  })
})
