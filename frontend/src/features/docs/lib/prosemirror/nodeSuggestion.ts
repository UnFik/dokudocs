import type { Node as ProseMirrorNode } from 'prosemirror-model'

// A suggestion on a whole node (a paragraph inserted or proposed for deletion)
// lives in the `suggestion` key of the node's bodyAttributes (ADR 0027).

export type NodeSuggestion = {
  kind: 'insert' | 'delete' | 'format'
  id: string
  author: string
  /** A format suggestion: the node type and attributes it would take. */
  toType?: string
  toAttributes?: Record<string, unknown>
}

/** All of the node's attributes, whether or not it has a suggestion. */
function parseAll(node: ProseMirrorNode): Record<string, unknown> {
  const raw = node.attrs.bodyAttributes
  if (typeof raw !== 'string') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** The attributes of a node that may carry a suggestion; a node without one is not parsed. */
function parse(node: ProseMirrorNode): Record<string, unknown> {
  const raw = node.attrs.bodyAttributes
  return typeof raw === 'string' && raw.includes('"suggestion"')
    ? parseAll(node)
    : {}
}

export function nodeSuggestionOf(node: ProseMirrorNode): NodeSuggestion | null {
  const suggestion = parse(node).suggestion as
    | Partial<NodeSuggestion>
    | undefined
  if (
    !suggestion ||
    typeof suggestion.id !== 'string' ||
    typeof suggestion.author !== 'string' ||
    (suggestion.kind !== 'insert' &&
      suggestion.kind !== 'delete' &&
      suggestion.kind !== 'format')
  )
    return null
  return suggestion as NodeSuggestion
}

/** The node's attributes with its suggestion set, or cleared when null. */
export function withNodeSuggestion(
  node: ProseMirrorNode,
  suggestion: NodeSuggestion | null
) {
  const attributes = parseAll(node)
  if (suggestion) attributes.suggestion = suggestion
  else delete attributes.suggestion
  return { ...node.attrs, bodyAttributes: JSON.stringify(attributes) }
}
