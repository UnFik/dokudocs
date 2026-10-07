import { Plugin, PluginKey, TextSelection } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { EditorView } from 'prosemirror-view'
import { moveTopLevelBlock } from './moveBlock'

function topLevelIndexAt(view: EditorView, x: number, y: number) {
  const found = view.posAtCoords({ left: x, top: y })
  if (!found) return null
  const $pos = view.state.doc.resolve(
    found.inside >= 0 ? found.inside : found.pos
  )
  // A block with no text (divider, page break, file, embed) is hit at the edge of the page body itself.
  if ($pos.depth === 1 && found.inside >= 0 && $pos.nodeAfter) return $pos.index(1)
  return $pos.depth >= 2 ? $pos.index(1) : null
}

function blockElement(view: EditorView, index: number) {
  let offset = 1
  const documentNode = view.state.doc.child(0)
  for (let i = 0; i < index; i++) offset += documentNode.child(i).nodeSize
  const dom = view.nodeDOM(offset)
  return dom instanceof HTMLElement ? dom : null
}

const selectedKey = new PluginKey<string | null>('selectedBlock')

/** Drag handle for top-level blocks; a move is an ordinary edit. */
export function blockHandlePlugin() {
  return new Plugin<string | null>({
    key: selectedKey,
    state: {
      init: () => null,
      apply: (tr, value) => {
        const meta = tr.getMeta(selectedKey) as string | null | undefined
        return meta === undefined ? value : meta
      },
    },
    props: {
      decorations(state) {
        const id = selectedKey.getState(state)
        if (!id) return null
        const found: Decoration[] = []
        state.doc.child(0).forEach((child, offset) => {
          if (child.attrs.nodeID === id)
            found.push(
              Decoration.node(1 + offset, 1 + offset + child.nodeSize, {
                class: 'dd-block-selected',
              })
            )
        })
        return DecorationSet.create(state.doc, found)
      },
    },
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
        view.dispatch(tr)
      }

      // The block the handle has focus on is the selected block.
      const mark = (id: string | null) => {
        if (selectedKey.getState(view.state) === (id ?? null)) return
        view.dispatch(view.state.tr.setMeta(selectedKey, id))
      }
      const deleteCurrent = () => {
        if (current === null) return
        const blocks = view.state.doc.child(0)
        const index = Math.min(current, blocks.childCount - 1)
        let from = 1
        for (let i = 0; i < index; i++) from += blocks.child(i).nodeSize
        const block = blocks.child(index)
        const tr = view.state.tr
        if (blocks.childCount === 1) {
          // A page keeps at least one line: the last block becomes an empty one.
          const empty = view.state.schema.nodes.paragraph!.create({
            nodeID: null,
            bodyAttributes: '{}',
            bodyContent: '',
          })
          tr.replaceWith(from, from + block.nodeSize, empty)
        } else tr.delete(from, from + block.nodeSize)
        current = null
        currentID = null
        handle.hidden = true
        view.dispatch(tr.setMeta(selectedKey, null))
        view.focus()
        const at = Math.min(from, view.state.doc.content.size - 1)
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.near(view.state.doc.resolve(at), -1)
          )
        )
      }
      handle.addEventListener('focus', () => {
        if (currentID !== null) mark(currentID)
      })
      handle.addEventListener('blur', () => mark(null))
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
        if (event.key === 'Backspace' || event.key === 'Delete') {
          event.preventDefault()
          deleteCurrent()
          return
        }
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
          if (view.hasFocus()) showForSelection()
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
