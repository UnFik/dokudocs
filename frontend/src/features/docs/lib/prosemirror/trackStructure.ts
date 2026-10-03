import {
  Fragment,
  type Node as ProseMirrorNode,
  type ResolvedPos,
} from 'prosemirror-model'
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
// rejecting removes the paragraph. Enter at the edge of a paragraph, a split in
// the middle of one (by copying the tail), a join, and pasting lines at the end
// of one all work in the document and in a quote. In a list the same moves work
// on items: Enter at the end opens the next item, in the middle it splits the
// item by copying its tail into a new one, at the start it opens an item above,
// Enter on an empty last item leaves the list, and Backspace or Delete joins two
// single-paragraph items. Nested lists and items with several blocks stay out.

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
  const parent = $from.node(blockDepth - 1)
  const inItem =
    parent.type.name === 'list_item' || parent.type.name === 'task_list_item'
  if (
    parent.type.name !== 'document' &&
    parent.type.name !== 'block_quote' &&
    !inItem
  )
    throw new UnsupportedSuggestionError(
      'A new line as a suggestion is not available here yet.'
    )
  const { before, after } = visibleBounds(block, selection.from)
  const ownID = ownInsertAbove($from, blockDepth, options.author)
  const empty = !before && !after
  // Before the first character only when there is text to push down.
  const insertBefore = !before && after && !empty
  if (inItem && ((before && after) || insertBefore) && !soleParagraph(parent))
    throw new UnsupportedSuggestionError(
      'An item with several blocks cannot be split as a suggestion yet. Put the caret at the end of its last paragraph.'
    )
  if (before && after) return suggestSplit(state, blockDepth, options)

  const id = ownID ?? newID(options)
  const newParagraph = () =>
    documentBodySchema.nodes.paragraph!.create({
      nodeID: crypto.randomUUID(),
      bodyAttributes: '{}',
      bodyContent: '',
    })

  if (inItem && empty && !ownID)
    return suggestLeaveList(state, blockDepth, id, options)

  // At the start of an item that has text, Enter opens an item above it.
  if (inItem && insertBefore) {
    const above = $from.before(blockDepth - 1)
    return state.tr.insert(
      above,
      insertedItem(parent.type, newParagraph(), id, options.author)
    )
  }

  // At the end of a list item's last paragraph, Enter opens the next item.
  if (inItem && $from.index(blockDepth - 1) === parent.childCount - 1) {
    const item = insertedItem(parent.type, newParagraph(), id, options.author)
    const afterItem = $from.after(blockDepth - 1)
    const tr = state.tr.insert(afterItem, item)
    return tr.setSelection(TextSelection.create(tr.doc, afterItem + 2))
  }

  const created = documentBodySchema.nodes.paragraph!.create(
    withNodeSuggestion(newParagraph(), {
      kind: 'insert',
      id,
      author: options.author,
    })
  )
  const at = insertBefore ? $from.before(blockDepth) : $from.after(blockDepth)
  const tr = state.tr.insert(at, created)
  if (!insertBefore) tr.setSelection(TextSelection.create(tr.doc, at + 1))
  return tr
}

const itemNames = ['list_item', 'task_list_item']

/** An item that holds one paragraph and nothing else. */
function soleParagraph(item: ProseMirrorNode) {
  return item.childCount === 1 && item.child(0).type.name === 'paragraph'
}

/** A new list item of `type` that carries an insert suggestion and holds `content`. */
function insertedItem(
  type: ProseMirrorNode['type'],
  content: ProseMirrorNode | Fragment,
  id: string,
  author: string
) {
  const template = type.create({
    nodeID: crypto.randomUUID(),
    bodyAttributes: JSON.stringify(
      type.name === 'task_list_item' ? { checked: false } : {}
    ),
    bodyContent: '',
  })
  return type.create(
    withNodeSuggestion(template, { kind: 'insert', id, author }),
    content
  )
}

/**
 * Enter on an empty item that is the last of its list: the item is proposed for
 * deletion and an inserted paragraph follows the list. Both belong to one
 * suggestion, so accepting leaves the paragraph where the item was.
 */
function suggestLeaveList(
  state: EditorState,
  blockDepth: number,
  id: string,
  options: TrackOptions
): Transaction {
  const { $from } = state.selection
  const itemDepth = blockDepth - 1
  const item = $from.node(itemDepth)
  const list = $from.node(itemDepth - 1)
  const container = $from.node(itemDepth - 2).type.name
  if (
    (container !== 'document' && container !== 'block_quote') ||
    list.childCount < 2 ||
    $from.index(itemDepth - 1) !== list.childCount - 1 ||
    !soleParagraph(item) ||
    nodeSuggestionOf(item)
  )
    throw new UnsupportedSuggestionError(
      'Leaving a list as a suggestion works on the last item of a top-level list. Delete the empty item instead.'
    )
  const after = $from.after(itemDepth - 1)
  const tr = state.tr.insert(
    after,
    documentBodySchema.nodes.paragraph!.create(
      withNodeSuggestion(
        documentBodySchema.nodes.paragraph!.create({
          nodeID: crypto.randomUUID(),
          bodyAttributes: '{}',
          bodyContent: '',
        }),
        { kind: 'insert', id, author: options.author }
      )
    )
  )
  tr.setNodeMarkup(
    $from.before(itemDepth),
    undefined,
    withNodeSuggestion(item, { kind: 'delete', id, author: options.author })
  )
  return tr.setSelection(TextSelection.create(tr.doc, after + 1))
}

/** The id of your own insert suggestion on the block at `depth` or on a block above it, such as a list item you inserted. */
export function ownInsertAbove(
  $pos: ResolvedPos,
  depth: number,
  author: string
): string | null {
  for (let level = depth; level > 0; level--) {
    const suggestion = nodeSuggestionOf($pos.node(level))
    if (suggestion?.kind === 'insert' && suggestion.author === author)
      return suggestion.id
  }
  return null
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

const marks = documentBodySchema.marks

/** The pieces of text in a paragraph that are not proposed for deletion, from `from` to `to`, and the runs that hold them. */
function copiedRuns(
  state: EditorState,
  paragraph: { node: ProseMirrorNode; start: number },
  from: number,
  to: number,
  id: string,
  author: string
) {
  const doc = state.doc
  paragraph.node.descendants((node) => {
    if (node.isLeaf && !node.isText)
      throw new UnsupportedSuggestionError(
        'This paragraph holds content a suggestion cannot copy yet.'
      )
    return true
  })
  const insert = marks.suggestion_insert!.create({ id, author })
  const byRun = new Map<
    number,
    { attrs: ProseMirrorNode['attrs']; text: ProseMirrorNode[] }
  >()
  const pieces: { start: number; end: number }[] = []
  for (const chunk of chunksOf(paragraph)) {
    const start = Math.max(chunk.start, from)
    const end = Math.min(chunk.end, to)
    if (start >= end || markOf(chunk, 'delete')) continue
    if (markOf(chunk, 'insert'))
      throw new UnsupportedSuggestionError(
        'Decide the suggestions in this text first, then split or join it.'
      )
    const $start = doc.resolve(start)
    const run = $start.parent
    const key = $start.before()
    if (run.type.name !== 'run') continue
    const group = byRun.get(key) ?? { attrs: run.attrs, text: [] }
    group.text.push(
      documentBodySchema.text(doc.textBetween(start, end), [
        ...chunk.marks,
        insert,
      ])
    )
    byRun.set(key, group)
    pieces.push({ start, end })
  }
  const runs = [...byRun.values()].map((group) =>
    documentBodySchema.nodes.run!.create(
      { ...group.attrs, nodeID: crypto.randomUUID() },
      group.text
    )
  )
  return { runs: Fragment.from(runs), pieces }
}

function insertedParagraph(runs: Fragment, id: string, author: string) {
  const template = documentBodySchema.nodes.paragraph!.create({
    nodeID: crypto.randomUUID(),
    bodyAttributes: '{}',
    bodyContent: '',
  })
  return documentBodySchema.nodes.paragraph!.create(
    withNodeSuggestion(template, { kind: 'insert', id, author }),
    runs
  )
}

/**
 * Enter in the middle of a paragraph. Nothing moves: the text after the caret is
 * proposed for deletion where it is, and a copy of it opens an inserted paragraph.
 * Accepting removes the original tail and keeps the copy.
 */
function suggestSplit(
  state: EditorState,
  blockDepth: number,
  options: TrackOptions
): Transaction {
  const { $from } = state.selection
  const paragraph = {
    node: $from.node(blockDepth),
    start: $from.start(blockDepth),
  }
  const id = newID(options)
  const { runs, pieces } = copiedRuns(
    state,
    paragraph,
    $from.pos,
    $from.end(blockDepth),
    id,
    options.author
  )
  const itemType = $from.node(blockDepth - 1).type
  const inItem = itemNames.includes(itemType.name)
  const at = inItem ? $from.after(blockDepth - 1) : $from.after(blockDepth)
  const copy = inItem
    ? insertedItem(
        itemType,
        documentBodySchema.nodes.paragraph!.create(
          {
            nodeID: crypto.randomUUID(),
            bodyAttributes: '{}',
            bodyContent: '',
          },
          runs
        ),
        id,
        options.author
      )
    : insertedParagraph(runs, id, options.author)
  const tr = state.tr.insert(at, copy)
  const deletion = marks.suggestion_delete!.create({
    id,
    author: options.author,
  })
  for (const piece of pieces) tr.addMark(piece.start, piece.end, deletion)
  return tr.setSelection(TextSelection.create(tr.doc, at + (inItem ? 3 : 2)))
}

/**
 * Backspace at the start of a paragraph, or Delete at the end of the one before
 * it: join the two. `upper` is the position before the first paragraph. The
 * second paragraph is proposed for deletion and a copy of its text is added to
 * the end of the first.
 */
export function suggestJoin(
  state: EditorState,
  upper: number,
  options: TrackOptions
): Transaction {
  const doc = state.doc
  const first = doc.nodeAt(upper)
  const secondPos = first ? upper + first.nodeSize : -1
  const second = secondPos >= 0 ? doc.nodeAt(secondPos) : null
  const parentName = doc.resolve(upper).parent.type.name
  if (
    first &&
    second &&
    itemNames.includes(first.type.name) &&
    first.type.name === second.type.name
  )
    return suggestJoinItems(state, upper, first, secondPos, second, options)
  if (
    !first ||
    !second ||
    (parentName !== 'document' && parentName !== 'block_quote') ||
    first.type.name !== 'paragraph' ||
    second.type.name !== 'paragraph' ||
    nodeSuggestionOf(first) ||
    nodeSuggestionOf(second)
  )
    throw new UnsupportedSuggestionError(
      'Joining as a suggestion works between two plain paragraphs for now.'
    )
  const id = newID(options)
  const secondBlock = { node: second, start: secondPos + 1 }
  const { runs } = copiedRuns(
    state,
    secondBlock,
    secondBlock.start,
    secondPos + second.nodeSize,
    id,
    options.author
  )
  const joinAt = upper + first.nodeSize - 1
  const tr = state.tr.setNodeMarkup(
    secondPos,
    undefined,
    withNodeSuggestion(second, {
      kind: 'delete',
      id,
      author: options.author,
    })
  )
  if (runs.size) tr.insert(joinAt, runs)
  return tr.setSelection(TextSelection.create(tr.doc, joinAt))
}

/** Joins two single-paragraph items: the second is proposed for deletion and a copy of its text goes to the end of the first. */
function suggestJoinItems(
  state: EditorState,
  upper: number,
  first: ProseMirrorNode,
  secondPos: number,
  second: ProseMirrorNode,
  options: TrackOptions
): Transaction {
  if (
    !soleParagraph(first) ||
    !soleParagraph(second) ||
    nodeSuggestionOf(first) ||
    nodeSuggestionOf(second) ||
    nodeSuggestionOf(first.child(0)) ||
    nodeSuggestionOf(second.child(0))
  )
    throw new UnsupportedSuggestionError(
      'Joining items as a suggestion works between two plain items with one paragraph each for now.'
    )
  const id = newID(options)
  const start = secondPos + 2
  const { runs } = copiedRuns(
    state,
    { node: second.child(0), start },
    start,
    secondPos + second.nodeSize - 2,
    id,
    options.author
  )
  const joinAt = upper + first.nodeSize - 2
  const tr = state.tr.setNodeMarkup(
    secondPos,
    undefined,
    withNodeSuggestion(second, { kind: 'delete', id, author: options.author })
  )
  if (runs.size) tr.insert(joinAt, runs)
  return tr.setSelection(TextSelection.create(tr.doc, joinAt))
}

/**
 * Where a Backspace (or Delete) at a paragraph's edge would join two paragraphs:
 * the position before the first of them, or null when the caret is not at that
 * edge. Text already proposed for deletion does not count as text.
 */
export function joinTarget(
  state: EditorState,
  forward: boolean
): number | null {
  const { selection, doc } = state
  if (!selection.empty) return null
  const block = textblockAt(doc, selection.from)
  if (!block) return null
  const $caret = doc.resolve(selection.from)
  let depth = $caret.depth
  while (depth > 0 && !$caret.node(depth).isTextblock) depth--
  if (depth === 0) return null
  const { before, after } = visibleBounds(block, selection.from)
  if (forward ? after : before) return null
  const here = $caret.before(depth)
  const item = depth > 1 ? $caret.node(depth - 1) : null
  if (item && itemNames.includes(item.type.name)) {
    const itemAt = $caret.before(depth - 1)
    const index = $caret.index(depth - 1)
    const list = $caret.node(depth - 2)
    const itemIndex = $caret.index(depth - 2)
    if (forward) {
      if (index !== item.childCount - 1 || itemIndex >= list.childCount - 1)
        return null
      return itemAt
    }
    if (index !== 0 || itemIndex === 0) return null
    return itemAt - list.child(itemIndex - 1).nodeSize
  }
  if (forward) return doc.nodeAt(here)?.type.name === 'paragraph' ? here : null
  const previous = doc.resolve(here).nodeBefore
  return previous ? here - previous.nodeSize : null
}
