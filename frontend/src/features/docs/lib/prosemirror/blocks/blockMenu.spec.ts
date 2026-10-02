import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { documentBodySchema, documentBodyToProseMirror } from '../documentBody'
import { prepareBodyTransaction } from '../prepareBodyTransaction'
import { blockMenuPlugin, filterBlockItems } from './blockMenu'
import { bodyBuilder, bodyOf, stateFor } from './testSupport'

const views: EditorView[] = []
afterEach(() => {
  views.splice(0).forEach((v) => v.destroy())
  document.body.replaceChildren()
})

function mount(text = '') {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  const p = b.add(root, 'paragraph')
  if (text) b.add(p, 'run', text)
  const mountEl = document.createElement('div')
  document.body.append(mountEl)
  const view: EditorView = new EditorView(mountEl, {
    state: EditorState.create({
      doc: stateFor(b.nodes, p).doc,
      selection: stateFor(b.nodes, p).selection,
      plugins: [blockMenuPlugin()],
    }),
    dispatchTransaction(tr) {
      const next = tr.docChanged ? prepareBodyTransaction(view.state, tr) : tr
      view.updateState(view.state.apply(next))
    },
  })
  views.push(view)
  void documentBodyToProseMirror
  return { view, mountEl }
}

function press(target: EventTarget, key: string) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return event
}

describe('filterBlockItems', () => {
  it('matches labels and keywords, ignoring case', () => {
    expect(filterBlockItems('head').map((i) => i.id)).toContain('heading-1')
    expect(filterBlockItems('TABLE').map((i) => i.id)).toEqual(['table'])
    expect(filterBlockItems('zzzz')).toEqual([])
    expect(filterBlockItems('').length).toBeGreaterThan(5)
  })
})

describe('block menu', () => {
  it('opens on / in an empty paragraph without typing the slash', () => {
    const { view, mountEl } = mount()
    view.focus()
    const event = press(view.dom, '/')
    expect(event.defaultPrevented).toBe(true)
    const input = mountEl.querySelector<HTMLInputElement>('[role="combobox"]')!
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(input.getAttribute('aria-label')).toBe('Insert block')
    expect(mountEl.querySelectorAll('[role="option"]').length).toBeGreaterThan(
      5
    )
    expect(view.state.doc.textContent).toBe('')
  })

  it('opens on / in a paragraph that only holds an empty run', () => {
    const { view, mountEl } = mount()
    view.updateState(
      view.state.apply(
        view.state.tr.insert(2, documentBodySchema.nodes.run.create())
      )
    )
    expect(view.state.selection.$from.parent.content.size).toBeGreaterThan(0)
    view.focus()
    expect(press(view.dom, '/').defaultPrevented).toBe(true)
    expect(mountEl.querySelector('[role="combobox"]')).not.toBeNull()
  })

  it('does not open inside a paragraph that has text', () => {
    const { view, mountEl } = mount('hello')
    view.focus()
    expect(press(view.dom, '/').defaultPrevented).toBe(false)
    expect(mountEl.querySelector('[role="combobox"]')).toBeNull()
  })

  it('filters, navigates with arrows and inserts the chosen block on Enter', () => {
    const { view, mountEl } = mount()
    view.focus()
    press(view.dom, '/')
    const input = mountEl.querySelector<HTMLInputElement>('[role="combobox"]')!
    input.value = 'heading'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    press(input, 'ArrowDown')
    const active = input.getAttribute('aria-activedescendant')!
    expect(mountEl.querySelector(`#${active}`)?.textContent).toContain(
      'Heading 2'
    )
    press(input, 'Enter')
    const heading = bodyOf(view.state.doc).find(
      (n) => n.type === 'atx-heading'
    )!
    expect(heading.attributes).toEqual({ level: 2 })
    expect(mountEl.querySelector('[role="combobox"]')).toBeNull()
  })

  it('closes on Escape and leaves the document unchanged', () => {
    const { view, mountEl } = mount()
    view.focus()
    press(view.dom, '/')
    const input = mountEl.querySelector<HTMLInputElement>('[role="combobox"]')!
    press(input, 'Escape')
    expect(mountEl.querySelector('[role="combobox"]')).toBeNull()
    expect(bodyOf(view.state.doc).map((n) => n.type)).toEqual([
      'document',
      'paragraph',
    ])
  })

  it('does not trigger while an IME composition is active', () => {
    const { view, mountEl } = mount()
    view.focus()
    const event = new KeyboardEvent('keydown', {
      key: '/',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    })
    view.dom.dispatchEvent(event)
    expect(mountEl.querySelector('[role="combobox"]')).toBeNull()
  })
})
