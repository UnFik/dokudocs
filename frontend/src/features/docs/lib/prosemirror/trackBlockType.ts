import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { EditorState, Transaction } from 'prosemirror-state'
import { setHeadingCommand } from './blockCommands'
import { nodeSuggestionOf, withNodeSuggestion } from './nodeSuggestion'
import { UnsupportedSuggestionError, type TrackOptions } from './trackChanges'

// A block's type in Suggest mode (ADR 0027). Turning a paragraph into a heading,
// changing a heading's level, or turning a heading back into a paragraph is a
// Format suggestion on the block: its `suggestion` holds the type and level it
// would take, and the block keeps its current ones until an editor accepts.

export type HeadingLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** The level a block has today: 0 for a paragraph. */
export function blockLevel(node: ProseMirrorNode): number {
  if (node.type.name !== 'atx_heading') return 0
  try {
    const parsed = JSON.parse(String(node.attrs.bodyAttributes ?? '{}')) as {
      level?: unknown
    }
    const level = Number(parsed.level)
    return Number.isInteger(level) ? Math.min(6, Math.max(1, level)) : 1
  } catch {
    return 1
  }
}

/** The level a block's own format suggestion proposes, or null. */
export function proposedLevel(node: ProseMirrorNode): number | null {
  const suggestion = nodeSuggestionOf(node)
  if (suggestion?.kind !== 'format' || !suggestion.toType) return null
  if (suggestion.toType === 'paragraph') return 0
  const level = Number(suggestion.toAttributes?.level)
  return Number.isInteger(level) ? level : 1
}

/** What a block-type suggestion is called on a card and in the document. */
export function levelLabel(level: number) {
  return level === 0 ? 'paragraph' : `heading ${level}`
}

/** Proposes a level for the block the caret is in; the same level as today takes the proposal back. */
export function suggestBlockType(
  state: EditorState,
  level: HeadingLevel,
  options: TrackOptions
): Transaction {
  const { $from } = state.selection
  let depth = $from.depth
  while (depth > 0 && !$from.node(depth).isTextblock) depth--
  const block = depth > 0 ? $from.node(depth) : null
  if (
    !block ||
    (block.type.name !== 'paragraph' && block.type.name !== 'atx_heading')
  )
    throw new UnsupportedSuggestionError(
      'A paragraph or a heading can change its type as a suggestion.'
    )
  const position = $from.before(depth)
  const existing = nodeSuggestionOf(block)

  if (existing && existing.author !== options.author)
    throw new UnsupportedSuggestionError(
      'Decide the other suggestion on this block first.'
    )
  if (existing?.kind === 'delete')
    throw new UnsupportedSuggestionError('This block is proposed for deletion.')
  // Your own inserted block is not canonical yet: change it for real.
  if (existing?.kind === 'insert') {
    let converted: Transaction | null = null
    setHeadingCommand(level)(state, (tr) => {
      converted = tr
    })
    return converted ?? state.tr
  }

  const tr = state.tr
  if (level === blockLevel(block)) {
    if (existing)
      tr.setNodeMarkup(position, undefined, withNodeSuggestion(block, null))
    return tr
  }
  tr.setNodeMarkup(
    position,
    undefined,
    withNodeSuggestion(block, {
      kind: 'format',
      id: existing?.id ?? (options.newID ?? (() => crypto.randomUUID()))(),
      author: options.author,
      toType: level === 0 ? 'paragraph' : 'atx_heading',
      toAttributes: level === 0 ? {} : { level },
    })
  )
  return tr
}
