import type { DocumentBodyNode } from './documentBody'

export type SuggestionOperation =
  | { op: 'delete'; nodeID: string }
  | { op: 'format'; nodeID: string; attributes: Record<string, boolean> }
  | {
      op: 'move'
      nodeID: string
      targetParentID: string
      beforeNodeID?: string
    }
  | {
      op: 'insert'
      nodeID: string
      parentID: string
      type: string
      content: string
      attributes: Record<string, never>
    }

export type SuggestionDraft = {
  operations: SuggestionOperation[]
  summary: string
}

export type FormatMark = 'bold' | 'italic' | 'strike' | 'code'

const markLabels: Record<FormatMark, { on: string; off: string }> = {
  bold: { on: 'bold', off: 'bold' },
  italic: { on: 'italic', off: 'italic' },
  strike: { on: 'struck through', off: 'strikethrough' },
  code: { on: 'code', off: 'code formatting' },
}

function clip(text: string) {
  return text.slice(0, 80)
}

function blockOf(nodes: DocumentBodyNode[], nodeID: string) {
  const byID = new Map(nodes.map((item) => [item.nodeID, item]))
  let block = byID.get(nodeID)
  if (!block) throw new Error('The selected block is no longer current')
  if (block.type === 'run' && block.parentID)
    block = byID.get(block.parentID) ?? block
  return block
}

function blockText(nodes: DocumentBodyNode[], block: DocumentBodyNode) {
  return clip(
    nodes
      .filter((item) => item.parentID === block.nodeID && item.type === 'run')
      .map((item) => item.content)
      .join('')
  )
}

function siblingsOf(nodes: DocumentBodyNode[], block: DocumentBodyNode) {
  return nodes
    .filter((item) => item.parentID === block.parentID)
    .sort((left, right) => left.siblingOrder - right.siblingOrder)
}

export function buildDeleteBlockSuggestion(
  nodes: DocumentBodyNode[],
  nodeID: string
): SuggestionDraft {
  const block = blockOf(nodes, nodeID)
  if (block.parentID === null)
    throw new Error('The document root cannot be deleted')
  if (block.type === 'opaque' || block.type === 'opaque-inline')
    throw new Error('This block cannot be changed by a suggestion')
  const text = blockText(nodes, block)
  return {
    operations: [{ op: 'delete', nodeID: block.nodeID }],
    summary: text ? `Delete ${block.type} “${text}”` : `Delete ${block.type}`,
  }
}

export function buildFormatSuggestion(
  nodes: DocumentBodyNode[],
  nodeID: string,
  mark: FormatMark
): SuggestionDraft {
  const run = nodes.find((item) => item.nodeID === nodeID)
  if (!run || run.type !== 'run')
    throw new Error('Place the cursor in text to format it')
  const turnOn = run.attributes[mark] !== true
  const label = markLabels[mark]
  const text = clip(run.content)
  return {
    operations: [
      { op: 'format', nodeID: run.nodeID, attributes: { [mark]: turnOn } },
    ],
    summary: turnOn
      ? `Make “${text}” ${label.on}`
      : `Remove ${label.off} from “${text}”`,
  }
}

export function buildMoveBlockSuggestion(
  nodes: DocumentBodyNode[],
  nodeID: string,
  direction: 'up' | 'down'
): SuggestionDraft {
  const block = blockOf(nodes, nodeID)
  if (block.parentID === null) throw new Error('The document root cannot move')
  if (block.type === 'opaque' || block.type === 'opaque-inline')
    throw new Error('This block cannot be changed by a suggestion')
  const siblings = siblingsOf(nodes, block)
  const index = siblings.findIndex((item) => item.nodeID === block.nodeID)
  let beforeNodeID: string | undefined
  if (direction === 'up') {
    if (index === 0) throw new Error('This block is already first')
    beforeNodeID = siblings[index - 1]!.nodeID
  } else {
    if (index === siblings.length - 1)
      throw new Error('This block is already last')
    beforeNodeID = siblings[index + 2]?.nodeID
  }
  const operation: SuggestionOperation = {
    op: 'move',
    nodeID: block.nodeID,
    targetParentID: block.parentID,
  }
  if (beforeNodeID) operation.beforeNodeID = beforeNodeID
  const text = blockText(nodes, block)
  return {
    operations: [operation],
    summary: text
      ? `Move ${block.type} “${text}” ${direction}`
      : `Move ${block.type} ${direction}`,
  }
}

export function buildInsertParagraphSuggestion(
  nodes: DocumentBodyNode[],
  anchorNodeID: string,
  text: string,
  newID: () => string
): SuggestionDraft {
  const content = text.trim()
  if (!content) throw new Error('Enter text to insert')
  const anchor = blockOf(nodes, anchorNodeID)
  const root = nodes.find((item) => item.parentID === null)
  if (!root || anchor.parentID !== root.nodeID)
    throw new Error('Insert is only available after a top-level block')
  const paragraphID = newID()
  const runID = newID()
  const operations: SuggestionOperation[] = [
    {
      op: 'insert',
      nodeID: paragraphID,
      parentID: root.nodeID,
      type: 'paragraph',
      content: '',
      attributes: {},
    },
    {
      op: 'insert',
      nodeID: runID,
      parentID: paragraphID,
      type: 'run',
      content,
      attributes: {},
    },
  ]
  const siblings = siblingsOf(nodes, anchor)
  const next =
    siblings[siblings.findIndex((item) => item.nodeID === anchor.nodeID) + 1]
  if (next)
    operations.push({
      op: 'move',
      nodeID: paragraphID,
      targetParentID: root.nodeID,
      beforeNodeID: next.nodeID,
    })
  return { operations, summary: `Insert paragraph “${clip(content)}”` }
}

const conflictMessages: Record<string, string> = {
  base: 'the document changed after this was proposed',
  'state-schema': 'the document changed after this was proposed',
  'missing-node': 'the target block no longer exists',
  'opaque-node': 'the target block cannot be edited by a suggestion',
  'no-change': 'it would not change the document',
  schema: 'this suggestion uses an unsupported format',
}

export function conflictReviewMessage(
  status: string,
  conflictReason: string
): string | null {
  if (status !== 'conflicted') return null
  const why =
    conflictMessages[conflictReason] ??
    'this suggestion no longer fits the document'
  return `Not applied: ${why}. Nothing was edited. Ask for a new suggestion on the current text.`
}

export type OverlayKind = 'delete' | 'replace_text' | 'format' | 'move'

export function pendingOverlay(
  suggestions: { status: string; operations: unknown }[]
): Map<string, OverlayKind[]> {
  const overlay = new Map<string, OverlayKind[]>()
  for (const suggestion of suggestions) {
    if (
      suggestion.status !== 'pending' ||
      !Array.isArray(suggestion.operations)
    )
      continue
    for (const raw of suggestion.operations as unknown[]) {
      if (typeof raw !== 'object' || raw === null) continue
      const { op, nodeID } = raw as { op?: unknown; nodeID?: unknown }
      if (typeof nodeID !== 'string') continue
      if (
        op !== 'delete' &&
        op !== 'replace_text' &&
        op !== 'format' &&
        op !== 'move'
      )
        continue
      const kinds = overlay.get(nodeID) ?? []
      if (!kinds.includes(op)) kinds.push(op)
      overlay.set(nodeID, kinds)
    }
  }
  return overlay
}

const overlayStyles: Record<OverlayKind, string> = {
  delete:
    'text-decoration: line-through; text-decoration-color: var(--destructive); background-color: color-mix(in srgb, var(--destructive) 10%, transparent);',
  replace_text:
    'text-decoration: underline; text-decoration-color: var(--signal); text-underline-offset: 3px; background-color: color-mix(in srgb, var(--signal) 10%, transparent);',
  format: 'border-bottom: 1px dashed var(--signal);',
  move: 'outline: 1px dashed var(--warn); outline-offset: 2px;',
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A stylesheet, not DOM attributes: ProseMirror re-renders nodes whose
// attributes change from outside, which loops in an editable view.
export function overlayCss(overlay: Map<string, OverlayKind[]>): string {
  const rules: string[] = []
  for (const [nodeID, kinds] of overlay) {
    if (!uuidPattern.test(nodeID)) continue
    rules.push(
      `.markdown-body [data-node-id="${nodeID}"] { ${kinds.map((kind) => overlayStyles[kind]).join(' ')} }`
    )
  }
  return rules.join('\n')
}
