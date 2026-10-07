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
  // A colored box around blocks; `variant` (info, success, warning, tip) is in its attributes.
  notice: { content: 'block+', group: 'block', tag: 'div' },
  // Blocks that can be folded: the first one is the title that stays visible.
  toggle: { content: 'block+', group: 'block', tag: 'div' },
  'page-break': { group: 'block', tag: 'hr', atom: true },
  // An uploaded file shown as a block: video, PDF or a download card. Its attributes hold src, fileName, contentType.
  attachment: { group: 'block', tag: 'div', atom: true },
  // A page of a known provider shown in a frame; attributes hold url and provider.
  embed: { group: 'block', tag: 'div', atom: true },
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
  // A person, page or project, by id; its label is what showed when it was made.
  mention: { group: 'inline', tag: 'span', atom: true },
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
  'notice',
  'toggle',
  'page-break',
  'attachment',
  'embed',
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
  'mention',
])
export const requiredContentTypes = new Set(['run', 'math', 'opaque-inline'])
export const markNames = [
  ['bold', 'strong'],
  ['italic', 'em'],
  ['strike', 'strike'],
  ['code', 'code'],
  ['underline', 'underline'],
  ['highlight', 'highlight'],
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

/** Blocks that hold source text: Enter adds a line and whitespace is kept as typed. */
const sourceTextTypes = new Set([
  'code-block',
  'math-block',
  'diagram',
  'frontmatter',
  'html-block',
  'link-reference-definition',
])

function nodeSpec(bodyType: string, definition: NodeDefinition): NodeSpec {
  return {
    ...(sourceTextTypes.has(bodyType) && { code: true }),
    ...(definition.content && { content: definition.content }),
    ...(definition.group && { group: definition.group }),
    ...(definition.group === 'inline' && { inline: true }),
    ...(textContentTypes.has(bodyType) && bodyType !== 'run' && { marks: '' }),
    attrs: bodyAttributes,
    ...(definition.atom && {
      atom: true,
      // Files, embeds and page breaks are chosen by clicking them, then deleted.
      selectable: ['attachment', 'embed', 'page-break'].includes(bodyType),
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

/** A stretched column or row: the cell or row keeps its size as pixels in bodyAttributes. */
function sizeStyle(bodyType: string, bodyAttributes: unknown) {
  try {
    const parsed = JSON.parse(String(bodyAttributes ?? '{}')) as {
      width?: unknown
      height?: unknown
    }
    if (bodyType === 'table.cell' && typeof parsed.width === 'number')
      return `width:${parsed.width}px;min-width:${parsed.width}px;max-width:${parsed.width}px`
    if (bodyType === 'table.row' && typeof parsed.height === 'number')
      return `height:${parsed.height}px`
  } catch {
    // Attributes the editor wrote are always JSON; anything else has no size.
  }
  return null
}

/** The column alignment kept in a cell's attributes; none draws the default. */
function cellAlign(bodyAttributes: unknown) {
  try {
    const value = (
      JSON.parse(String(bodyAttributes ?? '{}')) as { align?: unknown }
    ).align
    return value === 'left' || value === 'center' || value === 'right'
      ? value
      : null
  } catch {
    return null
  }
}

const noticeVariants = new Set(['info', 'success', 'warning', 'tip'])

function noticeVariant(bodyAttributes: unknown) {
  try {
    const value = (
      JSON.parse(String(bodyAttributes ?? '{}')) as { variant?: unknown }
    ).variant
    if (typeof value === 'string' && noticeVariants.has(value)) return value
  } catch {
    // Attributes the editor wrote are always JSON; anything else reads as info.
  }
  return 'info'
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
  if (bodyType === 'table.cell') {
    const align = cellAlign(node.attrs.bodyAttributes)
    return ['td', { ...idAttrs, ...(align ? { 'data-align': align } : {}) }, 0]
  }
  if (bodyType === 'notice') {
    const variant = noticeVariant(node.attrs.bodyAttributes)
    return [
      'div',
      {
        ...idAttrs,
        class: `dd-notice dd-notice-${variant}`,
        'data-variant': variant,
        role: 'note',
      },
      0,
    ]
  }
  if (bodyType === 'embed')
    return [
      'div',
      { ...idAttrs, class: 'dd-embed', contenteditable: 'false' },
      '[embed]',
    ]
  if (bodyType === 'attachment')
    return [
      'div',
      { ...idAttrs, class: 'dd-attachment', contenteditable: 'false' },
      '[file]',
    ]
  if (bodyType === 'page-break')
    return ['hr', { ...idAttrs, class: 'dd-page-break' }]
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
  if (bodyType === 'mention') {
    let label = ''
    let kind = 'person'
    try {
      const parsed = JSON.parse(String(node.attrs.bodyAttributes ?? '{}')) as {
        label?: unknown
        kind?: unknown
      }
      if (typeof parsed.label === 'string') label = parsed.label
      if (typeof parsed.kind === 'string') kind = parsed.kind
    } catch {
      // Attributes the editor wrote are always JSON; anything else shows an empty chip.
    }
    let id = ''
    try {
      id = String(
        (
          JSON.parse(String(node.attrs.bodyAttributes ?? '{}')) as {
            id?: unknown
          }
        ).id ?? ''
      )
    } catch {
      // The chip then has no link.
    }
    // A page or project is a link; a person is just named.
    const href =
      kind === 'document' && /^[0-9a-f-]{36}$/i.test(id)
        ? `/docs/${id}`
        : kind === 'project' && /^[0-9a-f-]{36}$/i.test(id)
          ? `/projects/${id}`
          : null
    return [
      href ? 'a' : 'span',
      {
        ...idAttrs,
        class: 'dd-mention',
        'data-mention-kind': kind,
        contenteditable: 'false',
        ...(href ? { href } : {}),
      },
      kind === 'person' ? `@${label}` : label,
    ]
  }
  if (bodyType === 'table.cell' || bodyType === 'table.row') {
    const style = sizeStyle(bodyType, node.attrs.bodyAttributes)
    return [definition.tag, style ? { ...idAttrs, style } : idAttrs, 0]
  }
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
    // Not Markdown: exported as inline HTML, <u> and <mark>.
    underline: { toDOM: () => ['u', 0] },
    highlight: { toDOM: () => ['mark', 0] },
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
