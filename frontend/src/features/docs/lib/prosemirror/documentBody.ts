import {
  Schema,
  type DOMOutputSpec,
  type Mark,
  type Node as ProseMirrorNode,
  type NodeSpec,
} from 'prosemirror-model'
import { indexDocumentBody, type DocumentBodyNode } from '../documentBody'

type NodeDefinition = {
  content?: string
  group?: string
  tag: string
  bodyContent?: boolean
  atom?: boolean
}

const definitions: Record<string, NodeDefinition> = {
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

const inlineParents = new Set([
  'paragraph',
  'atx-heading',
  'setext-heading',
  'table.cell',
])
const textContentTypes = new Set([
  'code-block',
  'html-block',
  'link-reference-definition',
  'math-block',
  'frontmatter',
  'diagram',
  'run',
  'math',
])
const bodyContentTypes = new Set(['opaque', 'opaque-inline', 'thematic-break'])
const emptyContentTypes = new Set([
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
const requiredContentTypes = new Set(['run', 'math', 'opaque-inline'])
const markNames = [
  ['bold', 'strong'],
  ['italic', 'em'],
  ['strike', 'strike'],
  ['code', 'code'],
] as const
const bodyTypeByProseMirrorName = new Map(
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

function toProseMirrorName(bodyType: string) {
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

function nodeDOM(
  bodyType: string,
  definition: NodeDefinition,
  node: ProseMirrorNode
): DOMOutputSpec {
  const idAttrs = {
    id: `node-${node.attrs.nodeID}`,
    'data-node-id': node.attrs.nodeID,
  }
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
  },
})

export function documentBodyToProseMirror(
  nodes: DocumentBodyNode[]
): ProseMirrorNode {
  const tree = indexDocumentBody(nodes)
  const toNode = (node: DocumentBodyNode): ProseMirrorNode => {
    const definition = definitions[node.type]
    if (!definition)
      throw new Error(`unsupported document body node type ${node.type}`)
    const children = tree.children(node.nodeID)
    if (emptyContentTypes.has(node.type) && node.content)
      throw new Error(`${node.type} node ${node.nodeID} cannot contain text`)
    if (requiredContentTypes.has(node.type) && !node.content)
      throw new Error(`${node.type} node ${node.nodeID} cannot be empty`)
    if (inlineParents.has(node.type) && node.content && children.length)
      throw new Error(
        `inline parent ${node.nodeID} has both text content and child nodes`
      )
    if (definition.bodyContent && children.length)
      throw new Error(`leaf node ${node.nodeID} cannot contain children`)
    if (textContentTypes.has(node.type) && children.length)
      throw new Error(`text node ${node.nodeID} cannot contain children`)

    const content = inlineParents.has(node.type)
      ? children.length
        ? children.map(toNode)
        : node.content
          ? [documentBodySchema.text(node.content)]
          : []
      : textContentTypes.has(node.type)
        ? node.content
          ? [
              documentBodySchema.text(
                node.content,
                node.type === 'run' ? marksForRun(node.attributes) : undefined
              ),
            ]
          : []
        : children.map(toNode)

    return documentBodySchema.nodes[toProseMirrorName(node.type)]!.create(
      {
        nodeID: node.nodeID,
        bodyAttributes: JSON.stringify(node.attributes),
        bodyContent: bodyContentTypes.has(node.type) ? node.content : '',
      },
      content
    )
  }

  const doc = documentBodySchema.topNodeType.create(null, [toNode(tree.root)])
  doc.check()
  return doc
}

export function prosemirrorToDocumentBody(
  doc: ProseMirrorNode
): DocumentBodyNode[] {
  if (doc.type !== documentBodySchema.topNodeType || doc.childCount !== 1)
    throw new Error('ProseMirror document must contain one DokuDocs document')
  doc.check()

  const rows: DocumentBodyNode[] = []
  const ids = new Set<string>()
  const visit = (
    node: ProseMirrorNode,
    parentID: string | null,
    siblingOrder: number
  ) => {
    const type = bodyTypeByProseMirrorName.get(node.type.name)
    if (!type) throw new Error(`unsupported ProseMirror node ${node.type.name}`)
    const nodeID = node.attrs.nodeID
    if (typeof nodeID !== 'string' || !nodeID)
      throw new Error(
        `ProseMirror node ${node.type.name} has no stable node ID`
      )
    if (ids.has(nodeID))
      throw new Error(`duplicate ProseMirror node ID ${nodeID}`)
    ids.add(nodeID)

    let attributes = parseAttributes(node.attrs.bodyAttributes, nodeID)
    let content = ''
    let astChildren: ProseMirrorNode[] = []
    if (inlineParents.has(type)) {
      const textChildren = Array.from({ length: node.childCount }, (_, i) =>
        node.child(i)
      ).filter((child) => child.isText)
      astChildren = Array.from({ length: node.childCount }, (_, i) =>
        node.child(i)
      ).filter((child) => !child.isText)
      if (textChildren.length && astChildren.length)
        throw new Error(
          `inline parent ${nodeID} mixes raw text and inline nodes`
        )
      if (textChildren.some((child) => child.marks.length))
        throw new Error(`inline parent ${nodeID} has unowned text marks`)
      content = textChildren.map((child) => child.text ?? '').join('')
    } else if (bodyContentTypes.has(type)) {
      content = node.attrs.bodyContent
    } else if (textContentTypes.has(type)) {
      content = node.textContent
      if (type === 'run') attributes = attributesForRun(node, attributes)
    } else {
      astChildren = Array.from({ length: node.childCount }, (_, i) =>
        node.child(i)
      )
    }

    if ((type === 'run' || type === 'math') && content.length === 0) return

    rows.push({ nodeID, parentID, siblingOrder, type, content, attributes })
    astChildren.forEach((child, index) => visit(child, nodeID, index))
  }

  visit(doc.child(0), null, 0)
  return rows
}

function marksForRun(attributes: Record<string, unknown>): Mark[] {
  const marks: Mark[] = []
  for (const [attribute, markName] of markNames)
    if (attributes[attribute] === true)
      marks.push(documentBodySchema.marks[markName]!.create())
  if (typeof attributes.href === 'string')
    marks.push(
      documentBodySchema.marks.link!.create({
        href: attributes.href,
        title:
          typeof attributes.linkTitle === 'string'
            ? attributes.linkTitle
            : null,
      })
    )
  return marks
}

function attributesForRun(
  node: ProseMirrorNode,
  attributes: Record<string, unknown>
) {
  let formatted: Record<string, unknown> | undefined
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child.isText)
      throw new Error(`run ${node.attrs.nodeID} contains a non-text child`)
    const current = attributesFromMarks(child.marks)
    if (formatted && JSON.stringify(current) !== JSON.stringify(formatted))
      throw new Error(
        `run ${node.attrs.nodeID} has mixed formatting; split it before projection`
      )
    formatted = current
  }

  for (const [attribute] of markNames) {
    if (formatted?.[attribute] === true) attributes[attribute] = true
    else if (attributes[attribute] === true) delete attributes[attribute]
  }
  if (typeof formatted?.href === 'string') {
    attributes.href = formatted.href
    if (typeof formatted.linkTitle === 'string')
      attributes.linkTitle = formatted.linkTitle
    else delete attributes.linkTitle
  } else if (typeof attributes.href === 'string') {
    delete attributes.href
    delete attributes.linkTitle
  }
  return attributes
}

function attributesFromMarks(marks: readonly Mark[]) {
  const attributes: Record<string, unknown> = {}
  for (const [attribute, markName] of markNames)
    if (marks.some((mark) => mark.type.name === markName))
      attributes[attribute] = true
  const link = marks.find((mark) => mark.type.name === 'link')
  if (link) {
    attributes.href = link.attrs.href
    if (typeof link.attrs.title === 'string')
      attributes.linkTitle = link.attrs.title
  }
  return attributes
}

function parseAttributes(value: unknown, nodeID: string) {
  if (typeof value !== 'string')
    throw new Error(`ProseMirror node ${nodeID} has invalid body attributes`)
  const attributes: unknown = JSON.parse(value)
  if (
    typeof attributes !== 'object' ||
    attributes === null ||
    Array.isArray(attributes)
  )
    throw new Error(`ProseMirror node ${nodeID} has invalid body attributes`)
  return attributes as Record<string, unknown>
}
