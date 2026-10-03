import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { nodeSuggestionOf } from './nodeSuggestion'
import { levelLabel, proposedLevel } from './trackBlockType'

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
  /** Text whose formatting the suggestion changes, and what it changes, such as `bold` or `remove italic`. */
  formatted: string
  formats: string[]
  /** Whole blocks the suggestion adds or removes; they count even when empty. */
  insertedBlocks: number
  deletedBlocks: number
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
        (suggestion.kind === 'insert' ||
          suggestion.kind === 'delete' ||
          suggestion.kind === 'format')
      ) {
        let card = cards.get(suggestion.id)
        if (!card) {
          card = {
            id: suggestion.id,
            author: suggestion.author,
            inserted: '',
            deleted: '',
            formatted: '',
            formats: [],
            insertedBlocks: 0,
            deletedBlocks: 0,
            position,
          }
          cards.set(suggestion.id, card)
        }
        if (suggestion.kind === 'insert') {
          // Its text carries insert marks of its own, counted below.
          card.insertedBlocks++
        } else if (suggestion.kind === 'format') {
          const label = levelLabel(proposedLevel(node) ?? 0)
          if (!card.formats.includes(label)) card.formats.push(label)
          card.formatted += node.textContent
        } else {
          card.deleted += node.textContent
          card.deletedBlocks++
        }
      }
      return true
    }
    for (const mark of node.marks) {
      const kind = mark.type.name.replace('suggestion_', '')
      if (kind !== 'insert' && kind !== 'delete' && kind !== 'format') continue
      const id = mark.attrs.id as string
      let card = cards.get(id)
      if (!card) {
        card = {
          id,
          author: mark.attrs.author as string,
          inserted: '',
          deleted: '',
          formatted: '',
          formats: [],
          insertedBlocks: 0,
          deletedBlocks: 0,
          position,
        }
        cards.set(id, card)
      }
      if (kind === 'insert') card.inserted += node.text ?? ''
      else if (kind === 'delete') card.deleted += node.text ?? ''
      else {
        card.formatted += node.text ?? ''
        const set = (mark.attrs.set ?? {}) as Record<string, unknown>
        for (const [key, value] of Object.entries(set)) {
          const name = key === 'href' ? 'link' : key
          const label =
            value === false || value === '' ? `remove ${name}` : name
          if (!card.formats.includes(label)) card.formats.push(label)
        }
      }
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
  // The same text added and removed along with a block is a split or a join.
  if (card.inserted && card.inserted === card.deleted) {
    if (card.insertedBlocks) return 'Split paragraph'
    if (card.deletedBlocks) return 'Join paragraphs'
  }
  if (card.inserted && card.deleted)
    return `Replace: "${shorten(card.deleted)}" with "${shorten(card.inserted)}"`
  if (card.formatted && !card.inserted && !card.deleted)
    return `Format: ${card.formats.join(', ')} "${shorten(card.formatted)}"`
  if (card.inserted) return `Add: "${shorten(card.inserted)}"`
  if (card.deleted) return `Delete: "${shorten(card.deleted)}"`
  // Blocks with no text of their own.
  return card.insertedBlocks
    ? `Add: ${card.insertedBlocks === 1 ? 'new paragraph' : `${card.insertedBlocks} new paragraphs`}`
    : `Delete: ${card.deletedBlocks === 1 ? 'empty paragraph' : `${card.deletedBlocks} empty paragraphs`}`
}
