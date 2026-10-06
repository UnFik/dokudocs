import { Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

function levelOf(bodyAttributes: unknown) {
  try {
    const level = (
      JSON.parse(String(bodyAttributes ?? '{}')) as { level?: unknown }
    ).level
    if (typeof level === 'number' && Number.isFinite(level))
      return Math.min(6, Math.max(1, Math.trunc(level)))
  } catch {
    // Attributes the editor wrote are always JSON; anything else reads as level 1.
  }
  return 1
}

/**
 * The level of each heading for the left margin (H2, drawn by CSS from
 * `data-heading-level`), and a button after it that hands the heading's node ID
 * to `onLink` so a link to it can be copied. Both are decorations with no text
 * of their own, so a heading's text stays what was typed.
 */
export function headingMarginPlugin(onLink: (nodeID: string) => void) {
  return new Plugin({
    props: {
      decorations(state) {
        const decorations: Decoration[] = []
        state.doc.descendants((node, pos) => {
          if (node.type.name !== 'atx_heading') return true
          const nodeID = String(node.attrs.nodeID ?? '')
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              'data-heading-level': `H${levelOf(node.attrs.bodyAttributes)}`,
            }),
            Decoration.widget(
              pos + node.nodeSize - 1,
              () => {
                const anchor = document.createElement('button')
                anchor.type = 'button'
                anchor.className = 'dd-heading-anchor'
                anchor.contentEditable = 'false'
                anchor.setAttribute('aria-label', 'Copy link to heading')
                anchor.addEventListener('mousedown', (event) =>
                  event.preventDefault()
                )
                anchor.addEventListener('click', () => onLink(nodeID))
                return anchor
              },
              { side: 1, key: `anchor-${nodeID}` }
            )
          )
          return false
        })
        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
}
