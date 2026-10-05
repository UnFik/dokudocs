import {
  Schema,
  type DOMOutputSpec,
  type Mark,
  type Node as ProseMirrorNode,
  type NodeSpec,
} from 'prosemirror-model'
import { authorColor } from '../author-color'

type NodeDefinition = {
  content?: string
  group?: string
  tag: string
  bodyContent?: boolean
  atom?: boolean
}

export const definitions: Record<string, NodeDefinition> = {
  document: { content: 'block*', tag: 'div' },
  paragraph: { content: 'inline*', group: 'block', tag: 'p' },
  'atx-heading': { content: 'inline*', group: 'block', tag: 'h1' },
  'setext-heading': { content: 'inline*', group: 'block', tag: 'h2' },
  'thematic-break': {
    group: 'block',
    tag: 'hr',
    bodyContent: true,
    atom: true,
  },
  'code-block': { content: 'text*', group: 'block', tag: 'pre' },
  'html-block': { content: 'text*', group: 'block', tag: 'div' },
  'link-reference-definition': {
    content: 'text*',
    group: 'block',
    tag: 'div',
  },
  'block-quote': { content: 'block*', group: 'block', tag: 'blockquote' },
  'order-list': { content: 'list_item+', group: 'block', tag: 'ol' },
  'bullet-list': { content: 'list_item+', group: 'block', tag: 'ul' },
  'task-list': { content: 'task_list_item+', group: 'block', tag: 'ul' },
  'list-item': { content: 'block+', group: 'list_item', tag: 'li' },
  'task-list-item': {
    content: 'block+',
    group: 'task_list_item',
    tag: 'li',
  },
  table: { content: 'table_row+', group: 'block', tag: 'table' },
  'table.row': { content: 'table_cell+', group: 'table_row', tag: 'tr' },
  'table.cell': { content: 'inline*', group: 'table_cell', tag: 'td' },
  'math-block': { content: 'text*', group: 'block', tag: 'pre' },
  frontmatter: { content: 'text*', group: 'block', tag: 'pre' },
  diagram: { content: 'text*', group: 'block', tag: 'pre' },
  footnote: { content: 'block*', group: 'block', tag: 'section' },
  opaque: {
    group: 'block',
    tag: 'pre',
    bodyContent: true,
    atom: true,
  },
  run: { content: 'text*', group: 'inline', tag: 'span' },
  image: { group: 'inline', tag: 'span', atom: true },
  math: { content: 'text*', group: 'inline', tag: 'span' },
  'line-break': { group: 'inline', tag: 'br', atom: true },
  'opaque-inline': {
    group: 'inline',
    tag: 'span',
    bodyContent: true,
    atom: true,
  },
}

export const inlineParents = new Set([
  'paragraph',
  'atx-heading',
  'setext-heading',
  'table.cell',
])
export const textContentTypes = new Set([
  'code-block',
  'html-block',
  'link-reference-definition',
  'math-block',
  'frontmatter',
  'diagram',
  'run',
  'math',
])
export const bodyContentTypes = new Set([
  'opaque',
  'opaque-inline',
  'thematic-break',
])
export const emptyContentTypes = new Set([
  'document',
  'block-quote',
  'order-list',
  'bullet-list',
  'task-list',
  'list-item',
  'task-list-item',
  'table',
  'table.row',
  'footnote',
  'image',
  'line-break',
])
export const requiredContentTypes = new Set(['run', 'math', 'opaque-inline'])
export const markNames = [
  ['bold', 'strong'],
  ['italic', 'em'],
  ['strike', 'strike'],
  ['code', 'code'],
] as const
export const bodyTypeByProseMirrorName = new Map(
  Object.keys(definitions).map((bodyType) => [
    toProseMirrorName(bodyType),
    bodyType,
  ])
)

const bodyAttributes = {
  nodeID: { default: null },
  bodyAttributes: { default: '{}' },
  bodyContent: { default: '' },
}

export function toProseMirrorName(bodyType: string) {
  return bodyType.replaceAll('-', '_').replaceAll('.', '_')
}

function nodeSpec(bodyType: string, definition: NodeDefinition): NodeSpec {
  return {
    ...(definition.content && { content: definition.content }),
    ...(definition.group && { group: definition.group }),
    ...(definition.group === 'inline' && { inline: true }),
    ...(textContentTypes.has(bodyType) && bodyType !== 'run' && { marks: '' }),
    attrs: bodyAttributes,
    ...(definition.atom && {
      atom: true,
      selectable: false,
      draggable: false,
      isolating: true,
    }),
    toDOM: (node) => nodeDOM(bodyType, definition, node),
  }
}

/** The level only lives in the bodyAttributes JSON; clamp it into h1-h6. */
function headingTag(bodyAttributes: unknown) {
  let level = 1
  try {
    const parsed = JSON.parse(String(bodyAttributes ?? '{}')) as {
      level?: unknown
    }
    if (typeof parsed.level === 'number' && Number.isFinite(parsed.level))
      level = Math.min(6, Math.max(1, Math.trunc(parsed.level)))
  } catch {
    // Invalid attributes fall back to h1; the server validates the real value.
  }
  return `h${level}`
}

function nodeDOM(
  bodyType: string,
  definition: NodeDefinition,
  node: ProseMirrorNode
): DOMOutputSpec {
  const idAttrs = {
    id: `node-${node.attrs.nodeID}`,
    'data-node-id': node.attrs.nodeID,
  }
  if (bodyType === 'atx-heading' || bodyType === 'setext-heading')
    return [headingTag(node.attrs.bodyAttributes), idAttrs, 0]
  if (bodyType === 'thematic-break')
    return [
      definition.tag,
      { ...idAttrs, 'data-source': node.attrs.bodyContent },
    ]
  if (bodyType === 'opaque' || bodyType === 'opaque-inline')
    return [
      definition.tag,
      { ...idAttrs, contenteditable: 'false' },
      node.attrs.bodyContent,
    ]
  if (bodyType === 'image')
    return ['span', { ...idAttrs, contenteditable: 'false' }, '[image]']
  if (bodyType === 'line-break') return ['br', idAttrs]
  if (bodyType === 'code-block') return ['pre', idAttrs, ['code', 0]]
  return [definition.tag, idAttrs, ...(definition.content ? [0] : [])]
}

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'document' },
  text: { group: 'inline' },
}
for (const [bodyType, definition] of Object.entries(definitions))
  nodes[toProseMirrorName(bodyType)] = nodeSpec(bodyType, definition)

export const documentBodySchema = new Schema({
  nodes,
  marks: {
    strong: { toDOM: () => ['strong', 0] },
    em: { toDOM: () => ['em', 0] },
    strike: { toDOM: () => ['s', 0] },
    code: { toDOM: () => ['code', 0] },
    link: {
      attrs: { href: {}, title: { default: null } },
      inclusive: false,
      toDOM: (mark) => ['span', { 'data-link-href': mark.attrs.href }, 0],
    },
    // Suggestions (ADR 0027). Text under suggestion_insert is proposed, not
    // canonical; the other two leave the text as it is. Typing at the end of
    // your own insertion continues it; typing after a deletion or a format
    // proposal does not.
    suggestion_insert: {
      attrs: { id: {}, author: {} },
      toDOM: (mark) => suggestionDOM(mark, 'suggest-ins'),
    },
    suggestion_delete: {
      attrs: { id: {}, author: {} },
      inclusive: false,
      toDOM: (mark) => suggestionDOM(mark, 'suggest-del'),
    },
    suggestion_format: {
      attrs: { id: {}, author: {}, set: { default: {} } },
      inclusive: false,
      toDOM: (mark) => {
        // One class per proposed value, so a preview can show the result.
        const set = (mark.attrs.set ?? {}) as Record<string, unknown>
        const proposed = Object.entries(set)
          .map(([key, value]) =>
            value === false || value === ''
              ? `suggest-fmt-no-${key}`
              : `suggest-fmt-${key}`
          )
          .join(' ')
        return suggestionDOM(mark, `suggest-fmt ${proposed}`.trim())
      },
    },
  },
})

function suggestionDOM(mark: Mark, className: string): DOMOutputSpec {
  return [
    'span',
    {
      class: className,
      'data-suggestion-id': mark.attrs.id,
      'data-suggestion-author': mark.attrs.author,
      // The author's color, for the line under or through the text.
      style: `--suggest-color: ${authorColor(String(mark.attrs.author))}`,
    },
    0,
  ]
}

/** Text under an insert suggestion is not part of the canonical body. */
export function isInserted(node: ProseMirrorNode) {
  return node.marks.some((mark) => mark.type.name === 'suggestion_insert')
}

export function isInsertSuggestion(value: unknown) {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'insert'
  )
}
