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

// A block move is a structural command: the editor locks, then the plugin views
// are rebuilt and the focused handle disappears with the old DOM. The key press
// leaves a note here so the next handle takes focus back for the same block and
// a keyboard user can keep moving it instead of landing on <body>.
let restoreFocus: { nodeID: string; index: number; at: number } | null = null
const RESTORE_WINDOW_MS = 10000

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
      let currentID: string | null = null

      const show = (index: number) => {
        const dom = blockElement(view, index)
        if (!dom || !view.editable) return false
        current = index
        currentID =
          (view.state.doc.child(0).child(index).attrs.nodeID as
            | string
            | null) ?? null
        const box = host.getBoundingClientRect()
        const rect = dom.getBoundingClientRect()
        handle.style.top = `${rect.top - box.top}px`
        handle.hidden = false
        return true
      }
      const move = (target: number) => {
        if (current === null) return
        const tr = moveTopLevelBlock(view.state, current, target)
        if (!tr) return
        if (currentID)
          restoreFocus = {
            nodeID: currentID,
            index: target > current ? current + 1 : current - 1,
            at: Date.now(),
          }
        view.dispatch(tr)
      }

      const onMove = (event: MouseEvent) => {
        const index = topLevelIndexAt(view, event.clientX, event.clientY)
        if (index !== null) show(index)
      }
      // The caret's block is the keyboard and touch path to the handle: no
      // pointer hover is needed to reach it.
      const showForSelection = () => {
        const { $from } = view.state.selection
        if ($from.depth >= 2) show($from.index(1))
      }
      const onLeave = (event: MouseEvent) => {
        if (event.relatedTarget === handle) return
        if (document.activeElement === handle) return
        if (view.hasFocus()) showForSelection()
        else handle.hidden = true
      }
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          view.focus()
          return
        }
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

      let destroyed = false
      const restoreFocusIfPending = () => {
        if (!restoreFocus || destroyed) return
        if (Date.now() - restoreFocus.at > RESTORE_WINDOW_MS) {
          restoreFocus = null
          return
        }
        const blocks = view.state.doc.child(0)
        let found = -1
        blocks.forEach((child, _offset, index) => {
          if (child.attrs.nodeID === restoreFocus!.nodeID) found = index
        })
        if (found < 0 && restoreFocus.index < blocks.childCount)
          found = restoreFocus.index
        if (found < 0) return
        // While a move is still syncing the editor is locked and the handle
        // stays hidden; keep the note and try again on the next update.
        if (!show(found)) return
        restoreFocus = null
        handle.focus()
      }
      setTimeout(restoreFocusIfPending, 0)

      view.dom.addEventListener('mousemove', onMove)
      view.dom.addEventListener('mouseleave', onLeave)
      view.dom.addEventListener('dragover', onDragOver)
      view.dom.addEventListener('drop', onDrop)
      handle.addEventListener('keydown', onKey)
      handle.addEventListener('dragstart', onDragStart)
      return {
        update() {
          const blocks = view.state.doc.child(0)
          if (current !== null && currentID !== null) {
            // Another client or the server may have moved the block.
            let found = -1
            blocks.forEach((child, _offset, index) => {
              if (child.attrs.nodeID === currentID) found = index
            })
            if (found < 0) {
              current = null
              currentID = null
              handle.hidden = true
            } else if (!handle.hidden) show(found)
          } else if (current !== null && current >= blocks.childCount) {
            handle.hidden = true
          }
          restoreFocusIfPending()
          if (view.hasFocus()) showForSelection()
        },
        destroy() {
          destroyed = true
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
