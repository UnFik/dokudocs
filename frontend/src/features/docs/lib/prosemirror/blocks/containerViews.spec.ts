import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { documentBodyToProseMirror } from '../documentBody'
import { bodyBuilder } from './testSupport'
import { toggleView } from './toggleNodeView'

const views: EditorView[] = []
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy())
  document.body.replaceChildren()
})

function mount() {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  const notice = b.add(root, 'notice', '', { variant: 'warning' })
  const np = b.add(notice, 'paragraph')
  b.add(np, 'run', 'Careful')
  const toggle = b.add(root, 'toggle')
  const title = b.add(toggle, 'paragraph')
  b.add(title, 'run', 'Title')
  const inner = b.add(toggle, 'paragraph')
  b.add(inner, 'run', 'Inside')
  b.add(root, 'page-break')
  const host = document.createElement('div')
  document.body.append(host)
  const view = new EditorView(host, {
    state: EditorState.create({ doc: documentBodyToProseMirror(b.nodes) }),
    nodeViews: { toggle: toggleView },
  })
  views.push(view)
  return { view, host }
}

describe('notice', () => {
  it('is a labelled box with its variant', () => {
    const { host } = mount()
    const notice = host.querySelector<HTMLElement>('.dd-notice')!
    expect(notice.getAttribute('data-variant')).toBe('warning')
    expect(notice.getAttribute('role')).toBe('note')
    expect(notice.textContent).toBe('Careful')
  })
})

describe('toggle', () => {
  it('shows a button that folds everything after the title, and unfolds it', () => {
    const { host } = mount()
    const button = host.querySelector<HTMLButtonElement>('.dd-toggle-button')!
    const toggle = host.querySelector<HTMLElement>('.dd-toggle')!
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-label')).toBe('Fold')

    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-label')).toBe('Unfold')
    expect(toggle.classList.contains('dd-toggle-folded')).toBe(true)

    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(toggle.classList.contains('dd-toggle-folded')).toBe(false)
  })

  it('keeps the title and the content as the editable text', () => {
    const { view } = mount()
    expect(view.state.doc.textContent).toBe('CarefulTitleInside')
  })
})

describe('page break', () => {
  it('is a rule that says what it is', () => {
    const { host } = mount()
    expect(host.querySelector('hr.dd-page-break')).not.toBeNull()
  })
})
