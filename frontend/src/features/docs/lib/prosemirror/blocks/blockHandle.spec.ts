import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MoveNodeRequiredError,
  prepareBodyTransaction,
} from '../prepareBodyTransaction'
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

  it('moves the block with arrow keys through a MoveNode intent', () => {
    const { view, host, errors, ids, root } = mount()
    hover(view, 0)
    const handle = host.querySelector<HTMLElement>('.dd-handle')!
    handle.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      })
    )
    expect(errors).toHaveLength(1)
    const move = errors[0] as MoveNodeRequiredError
    expect(move).toBeInstanceOf(MoveNodeRequiredError)
    expect(move.nodeID).toBe(ids[0])
    expect(move.targetParentID).toBe(root)
    expect(move.beforeNodeID).toBe(ids[2])
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
    expect(handle.hidden).toBe(true)
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
  it('keeps keyboard focus on the handle when the editor rebuilds its plugin views', async () => {
    const { view, host } = mount()
    hover(view, 0)
    const handle = host.querySelector<HTMLElement>('.dd-handle')!
    handle.focus()
    handle.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      })
    )
    // A structural command can swap the plugin set; the old handle is removed.
    view.updateState(view.state.reconfigure({ plugins: [blockHandlePlugin()] }))
    await new Promise((resolve) => setTimeout(resolve, 50))
    const active = document.activeElement as HTMLElement
    expect(active.classList.contains('dd-handle')).toBe(true)
    expect(active.hidden).toBe(false)
  })
})
