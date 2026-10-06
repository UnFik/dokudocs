import { Plugin, PluginKey, type EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import type { Command } from './insertBlock'
import { isSafeImageSource, insertImage, updateImage } from './mediaCommands'
import {
  addColumnAfter,
  addRowAfter,
  deleteRow,
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

/** Tools for the table the caret is in; inserting things is the block menu's job. */
export const defaultToolbarItems: ToolbarItem[] = [
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
]

const imageFormKey = new PluginKey<number>('imageForm')

/** Block menu command: opens the form for an image by address. */
export const requestImageForm: Command = (state, dispatch) => {
  if (!imageFormKey.get(state)) return false
  dispatch?.(state.tr.setMeta(imageFormKey, true))
  return true
}

function inTable(state: EditorState) {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--)
    if ($from.node(depth).type.name === 'table_cell') return true
  return false
}

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
  return new Plugin<number>({
    key: imageFormKey,
    state: {
      init: () => 0,
      apply: (tr, count) => (tr.getMeta(imageFormKey) ? count + 1 : count),
    },
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
            view.focus()
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

      const refresh = (_view?: EditorView, previous?: EditorState) => {
        bar.hidden = !(view.editable && inTable(view.state))
        if (
          previous &&
          imageFormKey.getState(view.state) !== imageFormKey.getState(previous)
        )
          openImageForm(view)
        items.forEach((entry, index) => {
          const enabled =
            view.editable && (!entry.command || entry.command(view.state))
          buttons[index]!.setAttribute('aria-disabled', String(!enabled))
        })
      }
      refresh()
      return { update: (v: EditorView, prev: EditorState) => refresh(v, prev), destroy: () => bar.remove() }
    },
  })
}
