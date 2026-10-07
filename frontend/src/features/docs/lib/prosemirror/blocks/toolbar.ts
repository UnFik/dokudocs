import { Plugin, PluginKey } from 'prosemirror-state'
import type { EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import type { Command } from './insertBlock'
import { isSafeImageSource, insertImage, updateImage } from './mediaCommands'

const imageFormKey = new PluginKey<number>('imageForm')

/** Block menu command: opens the form for an image by address. */
export const requestImageForm: Command = (state, dispatch) => {
  if (!imageFormKey.get(state)) return false
  dispatch?.(state.tr.setMeta(imageFormKey, true))
  return true
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
  host.prepend(form)
  src.focus()
}

/** Opens the image form when the block menu asks for it. */
export function imageFormPlugin() {
  return new Plugin<number>({
    key: imageFormKey,
    state: {
      init: () => 0,
      apply: (tr, count) => (tr.getMeta(imageFormKey) ? count + 1 : count),
    },
    view() {
      return {
        update(view: EditorView, previous: EditorState) {
          if (
            imageFormKey.getState(view.state) !==
            imageFormKey.getState(previous)
          )
            openImageForm(view)
        },
      }
    },
  })
}
