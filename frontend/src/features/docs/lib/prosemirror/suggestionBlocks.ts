import { Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { authorColor } from '../author-color'
import { nodeSuggestionOf } from './nodeSuggestion'

// Highlights a whole block that a suggestion inserts or proposes to delete, in
// its author's color (ADR 0027).
export const suggestionBlocksPlugin = new Plugin({
  props: {
    decorations: (state) => {
      const decorations: Decoration[] = []
      state.doc.descendants((node, pos) => {
        if (node.isText) return false
        const suggestion = nodeSuggestionOf(node)
        if (
          suggestion &&
          (suggestion.kind === 'insert' || suggestion.kind === 'delete')
        )
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              class: `suggest-block-${suggestion.kind === 'insert' ? 'ins' : 'del'}`,
              style: `--suggest-color: ${authorColor(suggestion.author)}`,
              'data-suggestion-id': suggestion.id,
            })
          )
        return true
      })
      return DecorationSet.create(state.doc, decorations)
    },
  },
})
