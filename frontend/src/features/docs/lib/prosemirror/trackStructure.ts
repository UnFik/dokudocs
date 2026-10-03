import {
  TextSelection,
  type EditorState,
  type Transaction,
} from 'prosemirror-state'
import { documentBodySchema } from './documentBody'
import { nodeSuggestionOf, withNodeSuggestion } from './nodeSuggestion'
import {
  chunksOf,
  markOf,
  suggestReplace,
  textblockAt,
  UnsupportedSuggestionError,
  type TrackOptions,
} from './trackChanges'

// Structure in Suggest mode (ADR 0027). A new paragraph is a node carrying an
// insert suggestion; nothing existing moves, so accepting clears the mark and
// rejecting removes the paragraph. Only the cases that need no copying are here:
// Enter at the edge of a paragraph, and pasting lines at the end of one. A split
// in the middle of text is refused until the copy-then-delete design lands.

const newID = (options: TrackOptions) =>
  (options.newID ?? (() => crypto.randomUUID()))()

/** Text that is not proposed for deletion: what the paragraph says now. */
function visibleBounds(block: ReturnType<typeof textblockAt>, caret: number) {
  let before = false
  let after = false
  for (const chunk of chunksOf(block!)) {
    if (markOf(chunk, 'delete')) continue
    if (chunk.start < caret) before = true
    if (chunk.end > caret) after = true
  }
  return { before, after }
}

/** Enter as a suggestion: an empty paragraph, inserted after the caret's paragraph (or before it when the caret is at its start). */
export function suggestEnter(
  state: EditorState,
  options: TrackOptions
): Transaction {
  const { selection } = state
  if (!selection.empty)
    throw new UnsupportedSuggestionError(
      'Delete the selection first, then press Enter.'
    )
  const block = textblockAt(state.doc, selection.from)
  const $from = state.doc.resolve(selection.from)
  let blockDepth = $from.depth
  while (blockDepth > 0 && !$from.node(blockDepth).isTextblock) blockDepth--
  if (!block || blockDepth === 0 || block.node.type.name !== 'paragraph')
    throw new UnsupportedSuggestionError(
      'A new line as a suggestion works in paragraphs for now.'
    )
  if ($from.node(blockDepth - 1).type.name !== 'document')
    throw new UnsupportedSuggestionError(
      'A new line as a suggestion is not available inside lists and quotes yet.'
    )
  const { before, after } = visibleBounds(block, selection.from)
  const own = nodeSuggestionOf(block.node)
  const ownInsert = own?.kind === 'insert' && own.author === options.author
  const empty = !before && !after
  // Before the first character only when there is text to push down.
  const insertBefore = !before && after && !empty
  if (before && after)
    throw new UnsupportedSuggestionError(
      'Splitting a paragraph in the middle is not available as a suggestion yet. Put the caret at its end.'
    )

  const id = ownInsert ? own.id : newID(options)
  const created = documentBodySchema.nodes.paragraph!.create(
    withNodeSuggestion(
      documentBodySchema.nodes.paragraph!.create({
        nodeID: crypto.randomUUID(),
        bodyAttributes: '{}',
        bodyContent: '',
      }),
      { kind: 'insert', id, author: options.author }
    )
  )
  const at = insertBefore ? $from.before(blockDepth) : $from.after(blockDepth)
  const tr = state.tr.insert(at, created)
  if (!insertBefore) tr.setSelection(TextSelection.create(tr.doc, at + 1))
  return tr
}

/**
 * Pastes text with line breaks: the first line goes in at the caret like typing,
 * every further line becomes an inserted paragraph. One suggestion for the lot.
 * Only at the end of a paragraph, where nothing has to move.
 */
export function suggestPasteLines(
  state: EditorState,
  text: string,
  options: TrackOptions
): Transaction {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const { from, to } = state.selection
  const block = textblockAt(state.doc, to)
  if (!block || textblockAt(state.doc, from)?.start !== block.start)
    throw new UnsupportedSuggestionError(
      'A suggestion can change text inside one paragraph at a time.'
    )
  if (visibleBounds(block, to).after)
    throw new UnsupportedSuggestionError(
      'Pasting several lines in the middle of a paragraph is not available as a suggestion yet. Paste at its end.'
    )
  const id = newID(options)
  const step: TrackOptions = {
    ...options,
    newID: () => id,
    continueAdjacent: false,
  }
  let current = state
  const applied: Transaction[] = []
  const apply = (transaction: Transaction) => {
    applied.push(transaction)
    current = current.apply(transaction)
  }
  apply(suggestReplace(current, from, to, lines[0]!, step))
  for (const line of lines.slice(1)) {
    apply(suggestEnter(current, step))
    if (line)
      apply(
        suggestReplace(
          current,
          current.selection.from,
          current.selection.to,
          line,
          step
        )
      )
  }
  // One transaction for the editor: the steps replayed on the original state.
  const tr = state.tr
  for (const transaction of applied)
    for (const replayed of transaction.steps) tr.step(replayed)
  return tr.setSelection(
    TextSelection.create(tr.doc, current.selection.from, current.selection.to)
  )
}
