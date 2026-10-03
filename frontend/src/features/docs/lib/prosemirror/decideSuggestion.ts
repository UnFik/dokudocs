import type { Mark, Node as ProseMirrorNode } from 'prosemirror-model'
import type { EditorState, Transaction } from 'prosemirror-state'
import { documentBodySchema } from './documentBody'
import { nodeSuggestionOf, withNodeSuggestion } from './nodeSuggestion'
import { UnsupportedSuggestionError } from './trackChanges'
import { formatKeys } from './trackFormat'

// Accepting or rejecting a suggestion is an ordinary edit by an editor (ADR 0027).
//
// Accepting an insertion clears its mark, and accepting a deletion removes the
// text. A run that is deleted whole is a canonical node, so removing it is a
// structural command (DeleteNode), not an edit: it is returned in
// `structuralDeletes` for the caller to send.
//
// Rejecting an insertion removes text that was never canonical, so it is an
// edit even when it removes a whole run; rejecting a deletion clears its mark.
// Someone else's insertion inside yours goes with yours.

export type SuggestionDecision = {
  transaction: Transaction
  /** Node IDs of canonical runs the decision removes entirely. */
  structuralDeletes: string[]
}

type Piece = {
  start: number
  end: number
  marks: readonly Mark[]
  /** The run holding the text, with the position just before it. */
  run: { node: ProseMirrorNode; before: number } | null
  /** The paragraph holding the run. */
  block: number
}

function isKind(mark: Mark, kind: 'insert' | 'delete' | 'format') {
  return mark.type.name === `suggestion_${kind}`
}

/** Every piece of text in the document, with where it sits. */
function pieces(doc: ProseMirrorNode): Piece[] {
  const result: Piece[] = []
  doc.descendants((node, pos) => {
    if (!node.isText) return true
    const $pos = doc.resolve(pos)
    const parent = $pos.parent
    const inRun = parent.type.name === 'run'
    result.push({
      start: pos,
      end: pos + node.nodeSize,
      marks: node.marks,
      run: inRun ? { node: parent, before: $pos.before($pos.depth) } : null,
      block: $pos.start(inRun ? $pos.depth - 1 : $pos.depth),
    })
    return false
  })
  return result
}

export function decideSuggestion(
  state: EditorState,
  id: string,
  decision: 'accept' | 'reject'
): SuggestionDecision {
  const all = pieces(state.doc)
  const mine = (piece: Piece, kind: 'insert' | 'delete' | 'format') =>
    piece.marks.find((mark) => isKind(mark, kind) && mark.attrs.id === id)
  const inserted = all.filter((piece) => mine(piece, 'insert'))
  const deleted = all.filter((piece) => mine(piece, 'delete'))
  const formatted = all.filter((piece) => mine(piece, 'format'))

  const tr = state.tr
  const structuralDeletes: string[] = []
  // Positions change only to the right of an edit, so work from the right.
  type Operation =
    | { kind: 'clear'; start: number; end: number; mark: Mark }
    | { kind: 'remove'; start: number; end: number }
    | { kind: 'removeRun'; start: number; end: number }
    | { kind: 'applyFormat'; start: number; end: number; mark: Mark }
    | { kind: 'clearBlock'; start: number; node: ProseMirrorNode }
    | { kind: 'removeBlock'; start: number; end: number }
  const operations: Operation[] = []

  // Suggestions on whole nodes: an inserted or deleted block.
  const blocks: { node: ProseMirrorNode; pos: number; kind: string }[] = []
  state.doc.descendants((node, pos) => {
    const suggestion = node.isText ? null : nodeSuggestionOf(node)
    if (suggestion?.id === id) blocks.push({ node, pos, kind: suggestion.kind })
    return true
  })

  const clearMark = (piece: Piece, mark: Mark) =>
    operations.push({ kind: 'clear', start: piece.start, end: piece.end, mark })

  // Removes text, or its whole run when that is all the run holds.
  const removeText = (targets: Piece[]) => {
    const byRun = new Map<number, Piece[]>()
    for (const piece of targets) {
      const key = piece.run?.before ?? -piece.start - 1
      byRun.set(key, [...(byRun.get(key) ?? []), piece])
    }
    for (const group of byRun.values()) {
      const { run } = group[0]!
      const removed = group.reduce(
        (sum, piece) => sum + piece.end - piece.start,
        0
      )
      if (run && removed === run.node.content.size)
        operations.push({
          kind: 'removeRun',
          start: run.before,
          end: run.before + run.node.nodeSize,
        })
      else
        for (const piece of group)
          operations.push({
            kind: 'remove',
            start: piece.start,
            end: piece.end,
          })
    }
  }

  if (decision === 'accept') {
    for (const block of blocks) {
      // A deleted block is canonical: it goes through DeleteNode.
      if (block.kind === 'delete')
        structuralDeletes.push(block.node.attrs.nodeID as string)
      else
        operations.push({
          kind: 'clearBlock',
          start: block.pos,
          node: block.node,
        })
    }
    for (const piece of inserted) clearMark(piece, mine(piece, 'insert')!)
    for (const piece of formatted)
      operations.push({
        kind: 'applyFormat',
        start: piece.start,
        end: piece.end,
        mark: mine(piece, 'format')!,
      })
    // A run deleted whole is canonical: it goes through DeleteNode.
    const runs = new Map<number, Piece[]>()
    for (const piece of deleted)
      if (piece.run)
        runs.set(piece.run.before, [
          ...(runs.get(piece.run.before) ?? []),
          piece,
        ])
    const partial: Piece[] = []
    for (const group of runs.values()) {
      const run = group[0]!.run!
      const removed = group.reduce(
        (sum, piece) => sum + piece.end - piece.start,
        0
      )
      if (removed < run.node.content.size) {
        partial.push(...group)
        continue
      }
      // Nothing canonical is left in the run, but other people's insertions
      // would be: they cannot survive in a run that no longer exists.
      const hasOthers = all.some(
        (piece) =>
          piece.run?.before === run.before &&
          !mine(piece, 'delete') &&
          piece.marks.some((mark) => isKind(mark, 'insert'))
      )
      if (hasOthers)
        throw new UnsupportedSuggestionError(
          'Decide the other suggestions in this text first.'
        )
      structuralDeletes.push(run.node.attrs.nodeID as string)
    }
    removeText(partial)
  } else {
    for (const block of blocks) {
      // An inserted block was never canonical, so it is removed by an edit.
      if (block.kind === 'insert')
        operations.push({
          kind: 'removeBlock',
          start: block.pos,
          end: block.pos + block.node.nodeSize,
        })
      else
        operations.push({
          kind: 'clearBlock',
          start: block.pos,
          node: block.node,
        })
    }
    // An insertion takes along what others typed inside it.
    const spans = new Map<number, { start: number; end: number }>()
    for (const piece of inserted) {
      const span = spans.get(piece.block)
      spans.set(piece.block, {
        start: Math.min(span?.start ?? piece.start, piece.start),
        end: Math.max(span?.end ?? piece.end, piece.end),
      })
    }
    removeText(
      all.filter((piece) => {
        const span = spans.get(piece.block)
        return (
          span !== undefined &&
          piece.start >= span.start &&
          piece.end <= span.end &&
          piece.marks.some((mark) => isKind(mark, 'insert'))
        )
      })
    )
    for (const piece of deleted) clearMark(piece, mine(piece, 'delete')!)
    for (const piece of formatted) clearMark(piece, mine(piece, 'format')!)
  }

  // A block that goes takes its contents with it; edits inside would delete
  // positions that no longer exist.
  const removedBlocks = operations.filter(
    (operation) => operation.kind === 'removeBlock'
  )
  const surviving = operations.filter(
    (operation) =>
      operation.kind === 'removeBlock' ||
      !removedBlocks.some(
        (block) =>
          block.kind === 'removeBlock' &&
          operation.start > block.start &&
          operation.start < block.end
      )
  )
  for (const operation of surviving.sort((a, b) => b.start - a.start)) {
    if (operation.kind === 'clear')
      tr.removeMark(operation.start, operation.end, operation.mark)
    else if (operation.kind === 'applyFormat') {
      const set = (operation.mark.attrs.set ?? {}) as Record<string, boolean>
      for (const [mark, key] of Object.entries(formatKeys)) {
        const type = documentBodySchema.marks[mark]!
        if (set[key] === true)
          tr.addMark(operation.start, operation.end, type.create())
        else if (set[key] === false)
          tr.removeMark(operation.start, operation.end, type)
      }
      tr.removeMark(operation.start, operation.end, operation.mark)
    } else if (operation.kind === 'clearBlock')
      tr.setNodeMarkup(
        operation.start,
        undefined,
        withNodeSuggestion(operation.node, null)
      )
    else tr.delete(operation.start, operation.end)
  }
  return { transaction: tr, structuralDeletes }
}
