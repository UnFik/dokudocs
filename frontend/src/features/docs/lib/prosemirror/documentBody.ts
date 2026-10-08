import { type Mark, type Node as ProseMirrorNode } from 'prosemirror-model'
import { indexDocumentBody, type DocumentBodyNode } from '../documentBody'
import {
  documentBodySchema,
  definitions,
  inlineParents,
  textContentTypes,
  bodyContentTypes,
  emptyContentTypes,
  requiredContentTypes,
  markNames,
  bodyTypeByProseMirrorName,
  toProseMirrorName,
  isInserted,
  isInsertSuggestion,
} from './documentSchema'

export { documentBodySchema }

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
  // Reports whether the node is canonical; a suggested insertion is not, and
  // neither is anything under it.
  const visit = (
    node: ProseMirrorNode,
    parentID: string | null,
    siblingOrder: number
  ): boolean => {
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
    const nodeSuggestion = attributes.suggestion
    delete attributes.suggestion
    if (isInsertSuggestion(nodeSuggestion)) return false
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
      content = canonicalText(node)
      if (type === 'run') attributes = attributesForRun(node, attributes)
    } else {
      astChildren = Array.from({ length: node.childCount }, (_, i) =>
        node.child(i)
      )
    }

    if ((type === 'run' || type === 'math') && content.length === 0)
      return false

    rows.push({ nodeID, parentID, siblingOrder, type, content, attributes })
    let kept = 0
    for (const child of astChildren) if (visit(child, nodeID, kept)) kept++
    return true
  }

  visit(doc.child(0), null, 0)
  return rows
}

function canonicalText(node: ProseMirrorNode) {
  let text = ''
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child.isText && !isInserted(child)) text += child.text ?? ''
    else if (!child.isText) text += child.textContent
  }
  return text
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
