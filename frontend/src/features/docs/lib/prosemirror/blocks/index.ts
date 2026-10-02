import { Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { blockHandlePlugin } from './blockHandle'
import { blockMenuPlugin } from './blockMenu'
import { clipboardPlugin } from './clipboard'
import { mediaNodeViews } from './mediaNodeViews'
import { goToNextCell, goToPreviousCell } from './tableCommands'
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
export function blockEditing() {
  const holder: { view?: EditorView } = {}
  return {
    plugins: [
      tableKeysPlugin(),
      clipboardPlugin(),
      blockMenuPlugin(),
      blockHandlePlugin(),
      toolbarPlugin(),
    ],
    nodeViews: mediaNodeViews({
      onImageEdit: (request) =>
        holder.view && openImageForm(holder.view, request),
    }),
    attach(view: EditorView) {
      holder.view = view
    },
  }
}
