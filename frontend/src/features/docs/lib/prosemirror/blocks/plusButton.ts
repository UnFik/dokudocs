import { Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { blankParagraphAtCaret, openBlockMenuEvent } from './blockMenu'

/** A + beside the empty line the caret is on; it opens the same block menu as "/". */
export function plusButtonPlugin() {
  return new Plugin({
    view(view: EditorView) {
      const host = view.dom.parentElement ?? document.body
      host.classList.add('dd-host')
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'dd-plus'
      button.hidden = true
      button.setAttribute('aria-label', 'Add block')
      button.textContent = '+'
      // Keep the caret where it is: a click would otherwise move focus off the empty line.
      button.addEventListener('mousedown', (event) => event.preventDefault())
      button.addEventListener('click', () => {
        view.focus()
        view.dom.dispatchEvent(new CustomEvent(openBlockMenuEvent))
      })
      host.append(button)

      const place = () => {
        const visible = view.editable && blankParagraphAtCaret(view) !== null
        button.hidden = !visible
        if (!visible) return
        const caret = view.coordsAtPos(view.state.selection.from)
        const box = host.getBoundingClientRect()
        const editor = view.dom.getBoundingClientRect()
        button.style.top = `${caret.top - box.top}px`
        button.style.left = `${Math.max(0, editor.left - box.left - 32)}px`
      }
      place()
      return {
        update: place,
        destroy() {
          button.remove()
        },
      }
    },
  })
}
