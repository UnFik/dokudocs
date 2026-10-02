import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareBodyTransaction } from '../prepareBodyTransaction'
import { bodyOf, bodyBuilder, stateFor } from './testSupport'
import { openImageForm, toolbarPlugin } from './toolbar'

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
      plugins: [toolbarPlugin()],
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

const key = (el: Element, k: string) =>
  el.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  )

describe('toolbar', () => {
  it('is a labelled toolbar of labelled buttons with one tab stop', () => {
    const { host } = mount()
    const bar = host.querySelector('[role="toolbar"]')!
    expect(bar.getAttribute('aria-label')).toBeTruthy()
    const buttons = [...bar.querySelectorAll('button')]
    expect(buttons.length).toBeGreaterThan(5)
    expect(buttons.every((b) => b.getAttribute('aria-label'))).toBe(true)
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1)
  })

  it('moves focus with arrow keys, Home and End', () => {
    const { host } = mount()
    const buttons = [
      ...host.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button'),
    ]
    buttons[0]!.focus()
    key(buttons[0]!, 'ArrowRight')
    expect(document.activeElement).toBe(buttons[1])
    key(buttons[1]!, 'End')
    expect(document.activeElement).toBe(buttons.at(-1))
    key(buttons.at(-1)!, 'ArrowRight')
    expect(document.activeElement).toBe(buttons[0])
  })

  it('enables table row actions only inside a table', () => {
    const outside = mount().host
    const addRow = outside.querySelector<HTMLButtonElement>(
      '[data-tool="add-row"]'
    )!
    expect(addRow.getAttribute('aria-disabled')).toBe('true')
    document.body.replaceChildren()
    const inside = mount(true).host
    expect(
      inside
        .querySelector('[data-tool="add-row"]')!
        .getAttribute('aria-disabled')
    ).toBe('false')
  })

  it('inserts a table when its button is activated', () => {
    const { view, host } = mount()
    host.querySelector<HTMLButtonElement>('[data-tool="table"]')!.click()
    expect(bodyOf(view.state.doc).some((n) => n.type === 'table')).toBe(true)
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
