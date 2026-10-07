import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareBodyTransaction } from '../prepareBodyTransaction'
import { filterBlockItems } from './blockMenu'
import { bodyOf, bodyBuilder, stateFor } from './testSupport'
import { openImageForm, requestImageForm, imageFormPlugin } from './toolbar'

const views: EditorView[] = []
afterEach(() => {
  views.splice(0).forEach((v) => v.destroy())
  document.body.replaceChildren()
})

function mount(withTable = false) {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  const p = b.add(root, 'paragraph')
  let cell = p
  if (withTable) {
    const t = b.add(root, 'table')
    const r = b.add(t, 'table.row')
    cell = b.add(r, 'table.cell', 'x', { align: 'none' })
  }
  const base = stateFor(b.nodes, cell)
  const host = document.createElement('div')
  document.body.append(host)
  const view: EditorView = new EditorView(host, {
    state: EditorState.create({
      doc: base.doc,
      selection: base.selection,
      plugins: [imageFormPlugin()],
    }),
    dispatchTransaction(tr) {
      view.updateState(
        view.state.apply(
          tr.docChanged ? prepareBodyTransaction(view.state, tr) : tr
        )
      )
    },
  })
  views.push(view)
  return { view, host }
}

describe('image form', () => {
  it('leaves inserting things to the block menu, which offers image and inline math', () => {
    const ids = (query: string) => filterBlockItems(query).map((i) => i.id)
    expect(ids('image')).toContain('image-address')
    expect(ids('inline')).toContain('inline-math')
    expect(ids('table')).toContain('table')
    expect(ids('mermaid')).toContain('mermaid')
  })

  it('opens the image form from the block menu command', () => {
    const { view, host } = mount()
    expect(requestImageForm(view.state, (tr) => view.dispatch(tr))).toBe(true)
    expect(host.querySelector('form[aria-label="Image"]')).not.toBeNull()
  })

  it('inserts an image from the form and rejects an unsafe address', () => {
    const { view, host } = mount()
    openImageForm(view)
    const form = host.querySelector('form[aria-label="Image"]')!
    const [src, alt] = [...form.querySelectorAll('input')]
    src!.value = 'javascript:alert(1)'
    form.dispatchEvent(
      new SubmitEvent('submit', { bubbles: true, cancelable: true })
    )
    expect(form.querySelector('[role="alert"]')?.textContent).toMatch(/http/i)
    expect(bodyOf(view.state.doc).some((n) => n.type === 'image')).toBe(false)
    src!.value = 'https://example.com/a.png'
    alt!.value = 'logo'
    form.dispatchEvent(
      new SubmitEvent('submit', { bubbles: true, cancelable: true })
    )
    expect(
      bodyOf(view.state.doc).find((n) => n.type === 'image')?.attributes
    ).toEqual({
      src: 'https://example.com/a.png',
      alt: 'logo',
    })
    expect(host.querySelector('form[aria-label="Image"]')).toBeNull()
  })
})
