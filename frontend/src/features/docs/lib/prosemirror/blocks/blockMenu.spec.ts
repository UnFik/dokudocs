import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { documentBodySchema, documentBodyToProseMirror } from '../documentBody'
import { prepareBodyTransaction } from '../prepareBodyTransaction'
import { blockItems, blockMenuPlugin, filterBlockItems } from './blockMenu'
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

describe('heading level 4', () => {
  it('is in the block menu, found by its level', () => {
    expect(filterBlockItems('h4').map((item) => item.id)).toContain('heading-4')
    expect(filterBlockItems('heading 4')[0]?.headingLevel).toBe(4)
  })
})

describe('filterBlockItems', () => {
  it('matches labels and keywords, ignoring case', () => {
    expect(filterBlockItems('head').map((i) => i.id)).toContain('heading-1')
    expect(filterBlockItems('TABLE').map((i) => i.id)).toEqual(['table'])
    expect(filterBlockItems('zzzz')).toEqual([])
    expect(filterBlockItems('').length).toBeGreaterThan(5)
  })
})

function typeText(view: EditorView, text: string) {
  view.dispatch(view.state.tr.insertText(text))
}

const combobox = (el: HTMLElement) =>
  el.querySelector<HTMLElement>('[role="combobox"]')

describe('block menu', () => {
  it('opens on / in an empty paragraph and writes the slash into the line', () => {
    const { view, mountEl } = mount()
    view.focus()
    const event = press(view.dom, '/')
    expect(event.defaultPrevented).toBe(true)
    const editor = combobox(mountEl)!
    expect(editor).toBe(view.dom)
    expect(editor.getAttribute('aria-expanded')).toBe('true')
    expect(editor.getAttribute('aria-label')).toBe('Insert block')
    expect(mountEl.querySelectorAll('[role="option"]').length).toBeGreaterThan(
      5
    )
    expect(view.state.doc.textContent).toBe('/')
    expect(mountEl.querySelector('input')).toBeNull()
  })

  it('gives every entry an icon or its heading level', () => {
    const { view, mountEl } = mount()
    view.focus()
    press(view.dom, '/')
    const options = [...mountEl.querySelectorAll('[role="option"]')]
    expect(options[0]?.querySelector('.dd-slash-level')?.textContent).toBe('H1')
    for (const option of options.slice(4))
      expect(option.querySelector('svg')).not.toBeNull()
  })

  it('shows a hint in the empty line, and another once the slash is typed', () => {
    const { view } = mount()
    view.focus()
    expect(
      view.dom.querySelector('.dd-empty-line')?.getAttribute('data-hint')
    ).toBe("Type '/' to insert…")
    press(view.dom, '/')
    expect(
      view.dom.querySelector('.dd-hint-line')?.getAttribute('data-hint')
    ).toBe('Keep typing to filter…')
    typeText(view, 'h')
    expect(view.dom.querySelector('.dd-hint-line')).toBeNull()
  })

  it('opens on / in a paragraph that only holds an empty run', () => {
    const { view, mountEl } = mount()
    view.updateState(
      view.state.apply(
        view.state.tr.insert(2, documentBodySchema.nodes.run.create())
      )
    )
    view.updateState(
      view.state.apply(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 3))
      )
    )
    expect(view.state.selection.$from.parent.type.name).toBe('run')
    view.focus()
    expect(press(view.dom, '/').defaultPrevented).toBe(true)
    expect(combobox(mountEl)).not.toBeNull()
  })

  it('does not open inside a paragraph that has text', () => {
    const { view, mountEl } = mount('hello')
    view.focus()
    expect(press(view.dom, '/').defaultPrevented).toBe(false)
    expect(combobox(mountEl)).toBeNull()
  })

  it('filters as you type, navigates with arrows and inserts the chosen block on Enter', () => {
    const { view, mountEl } = mount()
    view.focus()
    press(view.dom, '/')
    typeText(view, 'heading')
    expect(view.state.doc.textContent).toBe('/heading')
    press(view.dom, 'ArrowDown')
    const active = view.dom.getAttribute('aria-activedescendant')!
    expect(mountEl.querySelector(`#${active}`)?.textContent).toContain(
      'Heading 2'
    )
    press(view.dom, 'Enter')
    const heading = bodyOf(view.state.doc).find(
      (n) => n.type === 'atx-heading'
    )!
    expect(heading.attributes).toEqual({ level: 2 })
    expect(heading.content).toBe('')
    expect(combobox(mountEl)).toBeNull()
  })

  it('closes when nothing matches and keeps what was typed', () => {
    const { view, mountEl } = mount()
    view.focus()
    press(view.dom, '/')
    typeText(view, 'zzzz')
    expect(combobox(mountEl)).toBeNull()
    expect(view.state.doc.textContent).toBe('/zzzz')
  })

  it('closes when the slash is deleted', () => {
    const { view, mountEl } = mount()
    view.focus()
    press(view.dom, '/')
    view.dispatch(view.state.tr.delete(2, 3))
    expect(combobox(mountEl)).toBeNull()
  })

  it('closes on Escape and leaves the typed text in the line', () => {
    const { view, mountEl } = mount()
    view.focus()
    press(view.dom, '/')
    press(view.dom, 'Escape')
    expect(combobox(mountEl)).toBeNull()
    expect(view.dom.getAttribute('role')).not.toBe('combobox')
    expect(view.state.doc.textContent).toBe('/')
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
    expect(combobox(mountEl)).toBeNull()
  })
})

const blockItemsById = (id: string) =>
  blockItems.find((item) => item.id === id)!

describe('notice, toggle, page break and current date', () => {
  function choose(id: string) {
    const harness = mount()
    const item = blockItemsById(id)
    item.command(harness.view.state, (tr) => harness.view.dispatch(tr))
    return bodyOf(harness.view.state.doc)
  }

  it.each(['info', 'success', 'warning', 'tip'])(
    'offers a %s notice that takes the place of the empty line',
    (variant) => {
      const body = choose(`notice-${variant}`)
      expect(body.map((n) => n.type)).toEqual([
        'document',
        'notice',
        'paragraph',
      ])
      expect(body[1]!.attributes).toEqual({ variant })
    }
  )

  it('offers a toggle with a title line and a line of content', () => {
    const body = choose('toggle')
    expect(body.map((n) => n.type)).toEqual([
      'document',
      'toggle',
      'paragraph',
      'paragraph',
    ])
  })

  it('offers a toggle whose title is a heading', () => {
    const body = choose('toggle-heading')
    expect(body.map((n) => n.type)).toEqual([
      'document',
      'toggle',
      'atx-heading',
      'paragraph',
    ])
  })

  it('offers a page break', () => {
    const body = choose('page-break')
    expect(body.map((n) => n.type)).toEqual(['document', 'page-break'])
  })

  it('writes today’s date as text', () => {
    const body = choose('current-date')
    const text = body.find((n) => n.type === 'paragraph')!.content
    expect(text).toMatch(/\d{4}/)
  })
})
