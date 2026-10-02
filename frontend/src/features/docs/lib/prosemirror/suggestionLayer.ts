import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { diffText, type TextLayerEntry } from '../suggestion-draft'

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
