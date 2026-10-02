import { Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import type { Command } from './insertBlock'
import {
  insertDiagram,
  insertInlineMath,
  insertMathBlock,
  isSafeImageSource,
  insertImage,
  updateImage,
} from './mediaCommands'
import {
  addColumnAfter,
  addRowAfter,
  deleteRow,
  insertTable,
  setColumnAlign,
} from './tableCommands'

export interface ToolbarItem {
  id: string
  label: string
  text: string
  run: (view: EditorView) => boolean
  /** When set, the button is disabled while the command cannot apply. */
  command?: Command
}

const viaCommand =
  (command: Command) =>
  (view: EditorView): boolean =>
    command(view.state, (tr) => view.dispatch(tr))

const item = (
  id: string,
  label: string,
  text: string,
  command: Command
): ToolbarItem => ({
  id,
  label,
  text,
  command,
  run: viaCommand(command),
})

export const defaultToolbarItems: ToolbarItem[] = [
  item('table', 'Insert table', 'table', insertTable(3, 3)),
  item('add-row', 'Add table row below', '+row', addRowAfter),
  item('add-column', 'Add table column after', '+col', addColumnAfter),
  item('delete-row', 'Delete table row', '-row', deleteRow),
  item('align-left', 'Align column left', 'left', setColumnAlign('left')),
  item(
    'align-center',
    'Align column center',
    'center',
    setColumnAlign('center')
  ),
  item('align-right', 'Align column right', 'right', setColumnAlign('right')),
  {
    id: 'image',
    label: 'Insert image',
    text: 'image',
    run: (view) => {
      openImageForm(view)
      return true
    },
  },
  item('math-inline', 'Insert inline math', '$x$', insertInlineMath),
  item('math-block', 'Insert math block', '$$', insertMathBlock),
  item(
    'mermaid',
    'Insert Mermaid diagram',
    'mermaid',
    insertDiagram('mermaid')
  ),
]

/** Image form for inserting a new image or editing the one at `position`. */
export function openImageForm(
  view: EditorView,
  initial: { src: string; alt: string; position?: number } = {
    src: '',
    alt: '',
  }
) {
  const host = view.dom.parentElement ?? document.body
  host.querySelector('form[aria-label="Image"]')?.remove()
  const form = document.createElement('form')
  form.className = 'dd-image-form'
  form.setAttribute('aria-label', 'Image')

  const field = (label: string, value: string, type: string) => {
    const wrap = document.createElement('label')
    wrap.textContent = label
    const input = document.createElement('input')
    input.type = type
    input.value = value
    wrap.append(input)
    form.append(wrap)
    return input
  }
  const src = field('Address', initial.src, 'text')
  const alt = field('Description', initial.alt, 'text')
  const error = document.createElement('p')
  error.setAttribute('role', 'alert')
  const submit = document.createElement('button')
  submit.type = 'submit'
  submit.textContent = initial.position === undefined ? 'Insert' : 'Apply'
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.textContent = 'Cancel'
  form.append(error, submit, cancel)

  const close = () => {
    form.remove()
    view.focus()
  }
  cancel.addEventListener('click', close)
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close()
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const value = { src: src.value, alt: alt.value }
    if (!isSafeImageSource(value.src)) {
      error.textContent =
        'Use an http or https address, a relative path, or an image data URL.'
      src.focus()
      return
    }
    const command =
      initial.position === undefined
        ? insertImage(value)
        : updateImage(initial.position, value)
    command(view.state, (tr) => view.dispatch(tr))
    close()
  })
  const bar = host.querySelector('[role="toolbar"]')
  if (bar) bar.after(form)
  else host.prepend(form)
  src.focus()
}

export function toolbarPlugin(items: ToolbarItem[] = defaultToolbarItems) {
  return new Plugin({
    view(view) {
      const host = view.dom.parentElement ?? document.body
      const bar = document.createElement('div')
      bar.className = 'dd-tb'
      bar.setAttribute('role', 'toolbar')
      bar.setAttribute('aria-label', 'Insert and table tools')
      const buttons = items.map((entry) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.tool = entry.id
        button.textContent = entry.text
        button.setAttribute('aria-label', entry.label)
        button.title = entry.label
        button.tabIndex = -1
        button.addEventListener('mousedown', (event) => event.preventDefault())
        button.addEventListener('click', () => {
          if (button.getAttribute('aria-disabled') === 'true') return
          if (entry.run(view)) {
            if (entry.id !== 'image') view.focus()
          }
        })
        bar.append(button)
        return button
      })
      buttons[0]!.tabIndex = 0
      bar.addEventListener('keydown', (event) => {
        const index = buttons.indexOf(event.target as HTMLButtonElement)
        if (index < 0) return
        const next =
          event.key === 'ArrowRight'
            ? (index + 1) % buttons.length
            : event.key === 'ArrowLeft'
              ? (index + buttons.length - 1) % buttons.length
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buttons.length - 1
                  : -1
        if (next < 0) return
        event.preventDefault()
        buttons.forEach((b, i) => (b.tabIndex = i === next ? 0 : -1))
        buttons[next]!.focus()
      })
      host.insertBefore(bar, view.dom)

      const refresh = () => {
        items.forEach((entry, index) => {
          const enabled =
            view.editable && (!entry.command || entry.command(view.state))
          buttons[index]!.setAttribute('aria-disabled', String(!enabled))
        })
      }
      refresh()
      return { update: refresh, destroy: () => bar.remove() }
    },
  })
}
