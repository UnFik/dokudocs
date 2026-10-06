import { Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { blockHandlePlugin } from './blockHandle'
import { blockMenuPlugin } from './blockMenu'
import { clipboardPlugin } from './clipboard'
import { mediaNodeViews } from './mediaNodeViews'
import { plusButtonPlugin } from './plusButton'
import { goToNextCell, goToPreviousCell } from './tableCommands'
import { toggleView } from './toggleNodeView'
import { uploadsPlugin, type UploadsOptions } from './uploads'
import { openImageForm, toolbarPlugin } from './toolbar'

function tableKeysPlugin() {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (
          event.key !== 'Tab' ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        )
          return false
        const command = event.shiftKey ? goToPreviousCell : goToNextCell
        const handled = command(view.state, (tr) => view.dispatch(tr))
        if (handled) event.preventDefault()
        return handled
      },
    },
  })
}

/** Plugins and node views for the blocks, media, clipboard and toolbar work. */
export function blockEditing(
  files: {
    upload?: UploadsOptions['upload']
    resolveSource?: (src: string) => Promise<string>
    onUploadError?: (message: string) => void
  } = {}
) {
  const holder: { view?: EditorView } = {}
  return {
    plugins: [
      ...(files.upload
        ? [
            uploadsPlugin({
              upload: files.upload,
              enabled: () => holder.view?.editable ?? false,
              onError: files.onUploadError ?? (() => {}),
            }),
          ]
        : []),
      tableKeysPlugin(),
      clipboardPlugin(),
      blockMenuPlugin(),
      plusButtonPlugin(),
      blockHandlePlugin(),
      toolbarPlugin(),
    ],
    nodeViews: {
      ...mediaNodeViews({
        resolveSource: files.resolveSource,
        onImageEdit: (request) =>
          holder.view && openImageForm(holder.view, request),
      }),
      toggle: toggleView,
    },
    attach(view: EditorView) {
      holder.view = view
    },
  }
}
