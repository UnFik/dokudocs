import { Plugin } from 'prosemirror-state'
import type { NodeView, NodeViewConstructor } from 'prosemirror-view'
import { resolveEmbed } from '../../embeds'
import { createNode, insertBlock } from './insertBlock'

const sandbox =
  'allow-scripts allow-same-origin allow-popups allow-forms allow-presentation'

function attributesOf(node: { attrs: Record<string, unknown> }) {
  try {
    return JSON.parse(String(node.attrs.bodyAttributes)) as { url?: string }
  } catch {
    return {}
  }
}

/** A link pasted into an empty line becomes the page it points to, when the provider is known. */
export function embedPlugin() {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const text = event.clipboardData?.getData('text/plain')?.trim() ?? ''
        if (!text || /\s/.test(text)) return false
        const { $from } = view.state.selection
        if (
          !view.editable ||
          !view.state.selection.empty ||
          $from.parent.type.name !== 'paragraph' ||
          $from.parent.content.size !== 0
        )
          return false
        const found = resolveEmbed(text)
        if (!found) return false
        const handled = insertBlock(
          createNode('embed', { url: text, provider: found.provider })
        )(view.state, (tr) => view.dispatch(tr))
        if (handled) event.preventDefault()
        return handled
      },
    },
  })
}

export const embedView: NodeViewConstructor = (initial) => {
  const dom = document.createElement('div')
  dom.className = 'dd-embed'
  dom.contentEditable = 'false'
  let node = initial
  const render = () => {
    dom.replaceChildren()
    const nodeID = node.attrs.nodeID as string | null
    if (nodeID) {
      dom.id = `node-${nodeID}`
      dom.dataset.nodeId = nodeID
    }
    const url = attributesOf(node).url ?? ''
    const found = resolveEmbed(url)
    if (!found) {
      dom.textContent = url
      return
    }
    const frame = document.createElement('iframe')
    frame.src = found.src
    frame.title = found.name
    frame.loading = 'lazy'
    frame.setAttribute('sandbox', sandbox)
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
    frame.setAttribute('allowfullscreen', '')
    if (found.aspect) frame.style.aspectRatio = String(found.aspect)
    else frame.style.height = `${found.height ?? 480}px`
    dom.append(frame)
  }
  render()
  return {
    dom,
    update(next) {
      if (next.type !== node.type) return false
      if (attributesOf(next).url === attributesOf(node).url) {
        node = next
        return true
      }
      node = next
      render()
      return true
    },
    stopEvent: () => true,
    ignoreMutation: () => true,
  } satisfies NodeView
}

