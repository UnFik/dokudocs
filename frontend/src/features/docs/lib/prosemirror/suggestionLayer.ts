import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { diffText, type TextLayerEntry } from '../suggestion-draft'
import type {
  SuggestionDraft,
  SuggestionOperation,
} from '../suggestion-operations'

export type BlockRun = { nodeID: string; pos: number; text: string }

/** The caret as a run of a block and an offset into that run's current text. */
export type RunCaret = {
  blockID: string
  runs: BlockRun[]
  nodeID: string
  offset: number
}

function nodeIDOf(node: ProseMirrorNode) {
  return typeof node.attrs.nodeID === 'string'
    ? (node.attrs.nodeID as string)
    : null
}

export function findRun(doc: ProseMirrorNode, nodeID: string) {
  let found: BlockRun | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (node.type.name === 'run' && nodeIDOf(node) === nodeID)
      found = { nodeID, pos, text: node.textContent }
    return !found
  })
  return found as BlockRun | null
}

/**
 * Resolves a document position to the run it types into. A position between
 * two runs belongs to the run before it; null when the block has no run there.
 */
export function runCaretAt(doc: ProseMirrorNode, pos: number): RunCaret | null {
  const $pos = doc.resolve(pos)
  let depth = $pos.depth
  let runNode: ProseMirrorNode | null = null
  let offset = 0
  if ($pos.parent.type.name === 'run') {
    runNode = $pos.parent
    offset = $pos.parentOffset
    depth--
  }
  const block = $pos.node(depth)
  const blockID = nodeIDOf(block)
  if (!blockID || !block.isTextblock) return null
  const blockStart = $pos.start(depth)
  const runs: BlockRun[] = []
  block.forEach((child, childOffset) => {
    const nodeID = nodeIDOf(child)
    if (child.type.name === 'run' && nodeID)
      runs.push({
        nodeID,
        pos: blockStart + childOffset,
        text: child.textContent,
      })
  })
  if (!runNode) {
    const before = $pos.nodeBefore
    const after = $pos.nodeAfter
    if (before?.type.name === 'run') {
      runNode = before
      offset = before.textContent.length
    } else if (after?.type.name === 'run') {
      runNode = after
      offset = 0
    } else return null
  }
  const nodeID = nodeIDOf(runNode)
  if (!nodeID) return null
  return { blockID, runs, nodeID, offset }
}

export type LayerEntry = TextLayerEntry & { active?: boolean }

function entryClass(entry: LayerEntry, kind: 'ins' | 'del') {
  return [
    `suggest-${kind}`,
    entry.own ? 'suggest-own' : 'suggest-other',
    entry.active ? 'suggest-active' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * Draws suggested text over the canonical body: inserted text as widgets,
 * deleted text struck through. An entry whose run text has moved on since it
 * was typed is not drawn; the panel still lists it.
 */
export function suggestionDecorations(
  doc: ProseMirrorNode,
  entries: LayerEntry[]
): DecorationSet {
  const decorations: Decoration[] = []
  for (const entry of entries) {
    const run = findRun(doc, entry.nodeID)
    if (!run || run.text !== entry.base) continue
    let pos = run.pos + 1
    for (const segment of diffText(entry.base, entry.text)) {
      if (segment.kind === 'keep') {
        pos += segment.text.length
      } else if (segment.kind === 'delete') {
        decorations.push(
          Decoration.inline(pos, pos + segment.text.length, {
            class: entryClass(entry, 'del'),
            'data-suggestion-id': entry.suggestionID,
          })
        )
        pos += segment.text.length
      } else {
        const text = segment.text
        decorations.push(
          Decoration.widget(
            pos,
            () => {
              const span = document.createElement('span')
              span.className = entryClass(entry, 'ins')
              span.dataset.suggestionId = entry.suggestionID
              span.textContent = text
              return span
            },
            {
              // The caret at this position is drawn after the inserted text.
              side: -1,
              marks: [],
              key: `suggest-${entry.suggestionID}-${entry.nodeID}-${pos}-${entry.active ? 'a' : ''}-${text}`,
            }
          )
        )
      }
    }
  }
  return DecorationSet.create(doc, decorations)
}

export type SelectionDeletion =
  | { ok: true; draft: SuggestionDraft }
  | { ok: false; message: string }

const crossBlockRefusal =
  'This selection includes content that cannot be deleted by a suggestion. Select plain text and blocks only.'

/**
 * A deletion that spans blocks as one suggestion: blocks the selection covers
 * entirely are deleted whole, and text at the two ragged ends is removed from
 * its runs.
 */
export function deleteSelectionSuggestion(
  doc: ProseMirrorNode,
  from: number,
  to: number
): SelectionDeletion {
  const operations: SuggestionOperation[] = []
  let blocks = 0
  let partial = false
  let first = ''
  let refused = false
  const hasOpaque = (node: ProseMirrorNode) => {
    let found = false
    node.descendants((child) => {
      if (child.type.name === 'opaque' || child.type.name === 'opaque-inline')
        found = true
      return !found
    })
    return found || node.type.name === 'opaque'
  }
  doc.nodesBetween(from, to, (node, pos) => {
    if (refused || node.type.name === 'document' || node === doc) return true
    const nodeID = nodeIDOf(node)
    if (node.isBlock && nodeID && from <= pos && pos + node.nodeSize <= to) {
      if (hasOpaque(node)) refused = true
      else {
        operations.push({ op: 'delete', nodeID })
        blocks++
        first ||= node.textContent.slice(0, 40)
      }
      return false
    }
    if (!node.isTextblock) return true
    node.forEach((child, offset) => {
      const start = pos + 1 + offset
      const end = start + child.nodeSize
      const cutFrom = Math.max(from, start)
      const cutTo = Math.min(to, end)
      if (cutFrom >= cutTo) return
      const childID = nodeIDOf(child)
      if (child.type.name !== 'run' || !childID) {
        refused = true
        return
      }
      const text = child.textContent
      const index = (position: number) =>
        Math.min(text.length, Math.max(0, position - start - 1))
      const kept = text.slice(0, index(cutFrom)) + text.slice(index(cutTo))
      operations.push(
        kept
          ? {
              op: 'replace_text',
              nodeID: childID,
              content: kept,
              baseContent: text,
            }
          : { op: 'delete', nodeID: childID, baseContent: text }
      )
      partial = true
      first ||= text.slice(0, 40)
    })
    return false
  })
  if (refused || !operations.length)
    return { ok: false, message: crossBlockRefusal }
  const summary = blocks
    ? `Delete ${blocks} block${blocks === 1 ? '' : 's'}${partial ? ' and selected text' : ''}`
    : `Delete selected text “${first}”`
  return { ok: true, draft: { operations, summary } }
}
