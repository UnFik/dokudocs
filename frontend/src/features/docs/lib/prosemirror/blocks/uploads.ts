import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { markdownToSlice } from './clipboard'
import { createNode, insertBlock, insertInline } from './insertBlock'

export interface UploadedFile {
  url: string
  fileName: string
  contentType: string
  inline: boolean
}

export interface UploadsOptions {
  upload: (file: File) => Promise<UploadedFile>
  enabled: () => boolean
  onError: (message: string) => void
  /** Asks the person for files; the default opens the browser's file dialog. */
  chooseFiles?: () => Promise<File[]>
}

function place(view: EditorView, stored: UploadedFile) {
  const state = view.state
  if (stored.contentType.startsWith('image/') && stored.inline) {
    const node = createNode('image', {
      src: stored.url,
      alt: stored.fileName,
    })
    const result = insertInline(state, node)
    if (!result) return
    result.tr.setSelection(
      TextSelection.near(result.tr.doc.resolve(result.at + node.nodeSize))
    )
    view.dispatch(result.tr.scrollIntoView())
    return
  }
  insertBlock(
    createNode('attachment', {
      src: stored.url,
      fileName: stored.fileName,
      contentType: stored.contentType,
    })
  )(state, (tr) => view.dispatch(tr))
}

const markdownFile = /\.(md|markdown|mdown)$/i

/** A Markdown file is read into the page like pasted Markdown text. */
async function importMarkdown(view: EditorView, file: File) {
  const slice = await markdownToSlice(await file.text())
  if (view.isDestroyed) return
  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView())
}

async function uploadAll(
  view: EditorView,
  files: File[],
  options: UploadsOptions
) {
  // One after the other so the files land in the order they were given.
  for (const file of files) {
    try {
      if (markdownFile.test(file.name) || file.type === 'text/markdown') {
        await importMarkdown(view, file)
        continue
      }
      place(view, await options.upload(file))
    } catch (error) {
      options.onError(
        error instanceof Error ? error.message : 'The file could not be added'
      )
    }
  }
}

const pickerKey = new PluginKey<number>('uploadPicker')

/** Block menu command: opens the file dialog and adds what is chosen. */
export function requestFilePicker(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
) {
  if (!pickerKey.get(state)) return false
  dispatch?.(state.tr.setMeta(pickerKey, true))
  return true
}

function browserFileDialog() {
  return new Promise<File[]>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])))
    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })
}

/** Files pasted or dropped on the page are stored and shown in place. */
export function uploadsPlugin(options: UploadsOptions) {
  const take = (files: FileList | File[] | undefined, view: EditorView) => {
    const list = Array.from(files ?? [])
    if (!list.length || !options.enabled()) return false
    void uploadAll(view, list, options)
    return true
  }
  return new Plugin<number>({
    key: pickerKey,
    state: {
      init: () => 0,
      apply: (tr, count) => (tr.getMeta(pickerKey) ? count + 1 : count),
    },
    view: () => ({
      update(view, previous) {
        if (pickerKey.getState(view.state) === pickerKey.getState(previous))
          return
        void (options.chooseFiles ?? browserFileDialog)().then((files) =>
          take(files, view)
        )
      },
    }),
    props: {
      handlePaste(view, event) {
        const handled = take(event.clipboardData?.files, view)
        if (handled) event.preventDefault()
        return handled
      },
      handleDrop(view, event) {
        const handled = take(event.dataTransfer?.files, view)
        if (handled) event.preventDefault()
        return handled
      },
    },
  })
}
