import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareBodyTransaction } from '../prepareBodyTransaction'
import { blockMenuPlugin } from './blockMenu'
import { plusButtonPlugin } from './plusButton'
import { bodyBuilder, stateFor } from './testSupport'

const views: EditorView[] = []
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy())
  document.body.replaceChildren()
})

function mount(text: string) {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  const p = b.add(root, 'paragraph')
  if (text) b.add(p, 'run', text)
  const host = document.createElement('div')
  document.body.append(host)
  const start = stateFor(b.nodes, p)
  const view: EditorView = new EditorView(host, {
    state: EditorState.create({
      doc: start.doc,
      selection: start.selection,
      plugins: [blockMenuPlugin(), plusButtonPlugin()],
    }),
    dispatchTransaction(tr) {
      const next = tr.docChanged ? prepareBodyTransaction(view.state, tr) : tr
      view.updateState(view.state.apply(next))
    },
  })
  views.push(view)
  return { view, host }
}

const button = (host: HTMLElement) =>
  host.querySelector<HTMLButtonElement>('.dd-plus')

describe('the + button on an empty line', () => {
  it('shows next to an empty paragraph the caret is in, with a name', () => {
    const { host } = mount('')
    expect(button(host)?.hidden).toBe(false)
    expect(button(host)?.getAttribute('aria-label')).toBe('Add block')
  })

  it('is hidden on a line that has text', () => {
    const { host } = mount('text')
    expect(button(host)?.hidden).toBe(true)
  })

  it('opens the block menu when clicked', () => {
    const { host } = mount('')
    button(host)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(host.querySelector('[role="combobox"]')).not.toBeNull()
  })

  it('is hidden when the editor cannot be edited', () => {
    const { view, host } = mount('')
    view.setProps({ editable: () => false })
    view.dispatch(view.state.tr)
    expect(button(host)?.hidden).toBe(true)
  })
})
