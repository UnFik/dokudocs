import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareBodyTransaction } from '../prepareBodyTransaction'
import { blockHandlePlugin } from './blockHandle'
import { moveTopLevelBlock } from './moveBlock'
import { bodyBuilder, stateFor } from './testSupport'

const views: EditorView[] = []
afterEach(() => {
  views.splice(0).forEach((v) => v.destroy())
  document.body.replaceChildren()
})

function mount() {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  const ids = ['one', 'two', 'three'].map((t) => {
    const p = b.add(root, 'paragraph')
    b.add(p, 'run', t)
    return p
  })
  const host = document.createElement('div')
  document.body.append(host)
  const errors: unknown[] = []
  const base = stateFor(b.nodes, ids[0]!)
  const view: EditorView = new EditorView(host, {
    state: EditorState.create({
      doc: base.doc,
      plugins: [blockHandlePlugin()],
    }),
    dispatchTransaction(tr) {
      try {
        view.updateState(
          view.state.apply(
            tr.docChanged ? prepareBodyTransaction(view.state, tr) : tr
          )
        )
      } catch (e) {
        errors.push(e)
      }
    },
  })
  views.push(view)
  return { view, host, errors, ids, root }
}

function hover(view: EditorView, index: number) {
  const block = view.dom.querySelectorAll('[data-node-id]')[0]!.parentElement!
  const target = view.dom.querySelectorAll('p')[index]!
  void block
  const rect = target.getBoundingClientRect()
  view.dom.dispatchEvent(
    new MouseEvent('mousemove', {
      bubbles: true,
      clientX: rect.left + 10,
      clientY: rect.top + rect.height / 2,
    })
  )
}

describe('block handle', () => {
  it('shows a labelled handle next to the hovered block', () => {
    const { view, host } = mount()
    hover(view, 1)
    const handle = host.querySelector<HTMLElement>('.dd-handle')!
    expect(handle.hidden).toBe(false)
    expect(handle.getAttribute('aria-label')).toMatch(/move block/i)
    expect(handle.draggable).toBe(true)
  })

  it('moves the block with arrow keys', () => {
    const { view, host, errors } = mount()
    hover(view, 0)
    const handle = host.querySelector<HTMLElement>('.dd-handle')!
    handle.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      })
    )
    expect(errors).toEqual([])
    const order = [...view.dom.querySelectorAll('p')].map((p) => p.textContent)
    expect(order).toEqual(['two', 'one', 'three'])
  })

  it('does nothing for ArrowUp on the first block', () => {
    const { view, host, errors } = mount()
    hover(view, 0)
    host.querySelector<HTMLElement>('.dd-handle')!.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        bubbles: true,
        cancelable: true,
      })
    )
    expect(errors).toHaveLength(0)
  })
  it('shows the handle for the caret block without any mouse movement', () => {
    const { view, host } = mount()
    const handle = host.querySelector<HTMLElement>('.dd-handle')!
    view.focus()
    view.dispatch(view.state.tr.setMeta('refresh', true))
    expect(handle.hidden).toBe(false)
  })

  it('follows the block it moved, so the next arrow press moves the same block', () => {
    const { view, host } = mount()
    hover(view, 0)
    const handle = host.querySelector<HTMLElement>('.dd-handle')!
    const box = host.getBoundingClientRect()
    // The server applies the MoveNode and the editor receives the new document.
    const move = moveTopLevelBlock(view.state, 0, 2)!
    view.updateState(view.state.apply(move))
    const moved = view.dom.querySelectorAll('p')[1]!.getBoundingClientRect()
    expect(parseFloat(handle.style.top)).toBeCloseTo(moved.top - box.top, 0)
  })

  it('returns focus to the editor on Escape', () => {
    const { view, host } = mount()
    hover(view, 1)
    const handle = host.querySelector<HTMLElement>('.dd-handle')!
    handle.focus()
    handle.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    )
    expect(view.hasFocus()).toBe(true)
  })

  it('deletes the block the handle is on when Backspace or Delete is pressed on it', () => {
    for (const key of ['Backspace', 'Delete']) {
      document.body.replaceChildren()
      const { view, host, errors } = mount()
      hover(view, 1)
      const handle = host.querySelector<HTMLElement>('.dd-handle')!
      handle.focus()
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      })
      handle.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(errors).toEqual([])
      expect([...view.dom.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
        'one',
        'three',
      ])
    }
  })

  it('marks the block while the handle has focus', () => {
    const { view, host } = mount()
    hover(view, 1)
    host.querySelector<HTMLElement>('.dd-handle')!.focus()
    expect(view.dom.querySelectorAll('.dd-block-selected')).toHaveLength(1)
    expect(view.dom.querySelector('.dd-block-selected')!.textContent).toBe('two')
    view.focus()
    host.querySelector<HTMLElement>('.dd-handle')!.blur()
    expect(view.dom.querySelectorAll('.dd-block-selected')).toHaveLength(0)
  })
})
