import { Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { authorColor } from '../author-color'
import { nodeSuggestionOf } from './nodeSuggestion'
import { levelLabel, proposedLevel } from './trackBlockType'

// Highlights a whole block that a suggestion inserts or proposes to delete, in
// its author's color (ADR 0027).
export const suggestionBlocksPlugin = new Plugin({
  props: {
    decorations: (state) => {
      const decorations: Decoration[] = []
      state.doc.descendants((node, pos) => {
        if (node.isText) return false
        const suggestion = nodeSuggestionOf(node)
        if (suggestion?.kind === 'format') {
          const level = proposedLevel(node) ?? 0
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              class: `suggest-block-fmt suggest-block-to-${level === 0 ? 'p' : `h${level}`}`,
              style: `--suggest-color: ${authorColor(suggestion.author)}`,
              'data-suggestion-id': suggestion.id,
              'data-suggest-label': levelLabel(level),
            })
          )
        } else if (
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
