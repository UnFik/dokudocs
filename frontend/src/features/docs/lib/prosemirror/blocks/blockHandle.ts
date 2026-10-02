import { Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { moveTopLevelBlock } from './moveBlock'

function topLevelIndexAt(view: EditorView, x: number, y: number) {
  const found = view.posAtCoords({ left: x, top: y })
  if (!found) return null
  const $pos = view.state.doc.resolve(
    found.inside >= 0 ? found.inside : found.pos
  )
  return $pos.depth >= 2 ? $pos.index(1) : null
}

function blockElement(view: EditorView, index: number) {
  let offset = 1
  const documentNode = view.state.doc.child(0)
  for (let i = 0; i < index; i++) offset += documentNode.child(i).nodeSize
  const dom = view.nodeDOM(offset)
  return dom instanceof HTMLElement ? dom : null
}

/** Drag handle for top-level blocks; every move is a MoveNode intent. */
export function blockHandlePlugin() {
  return new Plugin({
    view(view) {
      const host = view.dom.parentElement ?? document.body
      host.classList.add('dd-host')
      const handle = document.createElement('button')
      handle.type = 'button'
      handle.className = 'dd-handle'
      handle.hidden = true
      handle.draggable = true
      handle.textContent = '::'
      handle.setAttribute(
        'aria-label',
        'Move block. Drag it, or press Arrow Up or Arrow Down.'
      )
      host.append(handle)
      let current: number | null = null

      const show = (index: number) => {
        const dom = blockElement(view, index)
        if (!dom || !view.editable) return
        current = index
        const box = host.getBoundingClientRect()
        const rect = dom.getBoundingClientRect()
        handle.style.top = `${rect.top - box.top}px`
        handle.hidden = false
      }
      const move = (target: number) => {
        if (current === null) return
        const tr = moveTopLevelBlock(view.state, current, target)
        if (tr) view.dispatch(tr)
      }

      const onMove = (event: MouseEvent) => {
        const index = topLevelIndexAt(view, event.clientX, event.clientY)
        if (index !== null) show(index)
      }
      const onLeave = (event: MouseEvent) => {
        if (event.relatedTarget === handle) return
        if (document.activeElement !== handle) handle.hidden = true
      }
      const onKey = (event: KeyboardEvent) => {
        if (current === null) return
        if (event.key === 'ArrowUp') move(current - 1)
        else if (event.key === 'ArrowDown') move(current + 2)
        else return
        event.preventDefault()
      }
      let dragFrom: number | null = null
      const onDragStart = (event: DragEvent) => {
        dragFrom = current
        event.dataTransfer?.setData('text/plain', '')
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
      }
      const onDragOver = (event: DragEvent) => {
        if (dragFrom !== null) event.preventDefault()
      }
      const onDrop = (event: DragEvent) => {
        if (dragFrom === null) return
        event.preventDefault()
        const index = topLevelIndexAt(view, event.clientX, event.clientY)
        const from = dragFrom
        dragFrom = null
        if (index === null) return
        const rect = blockElement(view, index)?.getBoundingClientRect()
        const below = rect ? event.clientY > rect.top + rect.height / 2 : false
        const tr = moveTopLevelBlock(view.state, from, index + (below ? 1 : 0))
        if (tr) view.dispatch(tr)
      }

      view.dom.addEventListener('mousemove', onMove)
      view.dom.addEventListener('mouseleave', onLeave)
      view.dom.addEventListener('dragover', onDragOver)
      view.dom.addEventListener('drop', onDrop)
      handle.addEventListener('keydown', onKey)
      handle.addEventListener('dragstart', onDragStart)
      return {
        update() {
          if (current !== null && current >= view.state.doc.child(0).childCount)
            handle.hidden = true
        },
        destroy() {
          view.dom.removeEventListener('mousemove', onMove)
          view.dom.removeEventListener('mouseleave', onLeave)
          view.dom.removeEventListener('dragover', onDragOver)
          view.dom.removeEventListener('drop', onDrop)
          handle.remove()
        },
      }
    },
  })
}
