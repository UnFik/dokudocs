import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { nodeSuggestionOf } from './nodeSuggestion'

// What the review rail shows for a suggestion. A card is not stored: its kind and
// title are worked out from the marks, so a suggestion that gains a deletion next
// to its insertion turns from Add into Replace by itself.

export type SuggestionCard = {
  id: string
  author: string
  /** Text proposed to be added, in document order. */
  inserted: string
  /** Text proposed to be removed, in document order. */
  deleted: string
  /** Where the suggestion first appears in the document. */
  position: number
}

/** The suggestions in a document, in the order they first appear. */
export function suggestionCards(doc: ProseMirrorNode): SuggestionCard[] {
  const cards = new Map<string, SuggestionCard>()
  doc.descendants((node, position) => {
    if (!node.isText) {
      // A whole block proposed for deletion, or inserted.
      const suggestion = nodeSuggestionOf(node)
      if (
        suggestion &&
        (suggestion.kind === 'insert' || suggestion.kind === 'delete')
      ) {
        let card = cards.get(suggestion.id)
        if (!card) {
          card = {
            id: suggestion.id,
            author: suggestion.author,
            inserted: '',
            deleted: '',
            position,
          }
          cards.set(suggestion.id, card)
        }
        if (suggestion.kind === 'insert') card.inserted += node.textContent
        else card.deleted += node.textContent
      }
      return true
    }
    for (const mark of node.marks) {
      const kind = mark.type.name.replace('suggestion_', '')
      if (kind !== 'insert' && kind !== 'delete') continue
      const id = mark.attrs.id as string
      let card = cards.get(id)
      if (!card) {
        card = {
          id,
          author: mark.attrs.author as string,
          inserted: '',
          deleted: '',
          position,
        }
        cards.set(id, card)
      }
      if (kind === 'insert') card.inserted += node.text ?? ''
      else card.deleted += node.text ?? ''
    }
    return false
  })
  return [...cards.values()]
}

const titleLength = 40

function shorten(text: string) {
  return text.length > titleLength ? `${text.slice(0, titleLength)}…` : text
}

/** `Add: "xxx"`, `Delete: "xxx"`, or `Replace: "xxx" with "zzz"`. */
export function cardTitle(card: SuggestionCard) {
  if (card.inserted && card.deleted)
    return `Replace: "${shorten(card.deleted)}" with "${shorten(card.inserted)}"`
  if (card.inserted) return `Add: "${shorten(card.inserted)}"`
  return `Delete: "${shorten(card.deleted)}"`
}
