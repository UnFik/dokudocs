import { indexDocumentBody, type DocumentBodyNode } from '../../documentBody'
import { beginRules } from '../inlineRenderer/rules'
import type { Labels } from '../inlineRenderer/types'
import { inlineNodesToMarkdown } from './inlineNodesToMarkdown'
import type { InlineAttributes, InlineNode } from './markdownToInlineNodes'
import ExportMarkdown from './stateToMarkdown'
import type { TState } from './types'

export type { DocumentBodyNode } from '../../documentBody'

export function documentBodyToMarkdown(nodes: DocumentBodyNode[]): string {
  const { root, children } = indexDocumentBody(nodes)
  const labels = collectLabels(nodes)
  const sourceGaps = (root.attributes.sourceGaps ?? {}) as Record<
    string,
    string
  >
  const sourceTables = (root.attributes.sourceTables ?? {}) as Record<
    string,
    string
  >
  const states = children(root.nodeID).map((node) =>
    toState(node, children, labels, sourceGaps, sourceTables)
  )
  const markdown = new ExportMarkdown().generate(states)
  const trailingWhitespace = root.attributes.trailingWhitespace
  return typeof trailingWhitespace === 'string'
    ? markdown.replace(/[ \t\r\n]*$/, '') + trailingWhitespace
    : markdown
}

function toState(
  node: DocumentBodyNode,
  children: (parentID: string) => DocumentBodyNode[],
  labels: Labels,
  sourceGaps: Record<string, string>,
  sourceTables: Record<string, string>
): TState {
  const state = toStateBody(node, children, labels, sourceGaps, sourceTables)
  const sourceGap = sourceGaps[node.nodeID]
  if (Object.hasOwn(sourceGaps, node.nodeID)) state.sourceGap = sourceGap
  if (state.name === 'table' && sourceTables[node.nodeID])
    state.sourceMarkdown = sourceTables[node.nodeID]
  return state
}

function toStateBody(
  node: DocumentBodyNode,
  children: (parentID: string) => DocumentBodyNode[],
  labels: Labels,
  sourceGaps: Record<string, string>,
  sourceTables: Record<string, string>
): TState {
  const descendants = children(node.nodeID)
  const childStates = () =>
    descendants.map((child) =>
      toState(child, children, labels, sourceGaps, sourceTables)
    )

  switch (node.type) {
    case 'block-quote':
      return { name: 'block-quote', children: childStates() }
    case 'notice': {
      const variant = requiredChoice(node.attributes, 'variant', [
        'info',
        'success',
        'warning',
        'tip',
      ])
      return {
        name: 'fence-container',
        meta: { marker: ':::', label: variant },
        children: childStates(),
      }
    }
    case 'toggle':
      return {
        name: 'fence-container',
        meta: { marker: '+++', label: '' },
        children: childStates(),
      }
    case 'page-break':
      noChildren(node, descendants)
      return { name: 'html-block', text: '<div class="page-break"></div>' }
    case 'list-item':
      return { name: 'list-item', children: childStates() }
    case 'task-list-item':
      return {
        name: 'task-list-item',
        meta: { checked: requiredBoolean(node.attributes, 'checked') },
        children: childStates(),
      }
    case 'order-list': {
      const start = requiredNumber(node.attributes, 'start')
      if (!Number.isInteger(start) || start < 1)
        throw new Error('ordered list start must be a positive integer')
      return {
        name: 'order-list',
        meta: {
          start,
          loose: requiredBoolean(node.attributes, 'loose'),
          delimiter: requiredChoice(node.attributes, 'delimiter', ['.', ')']),
        },
        children: requireNamed(childStates(), 'list-item'),
      }
    }
    case 'bullet-list':
      return {
        name: 'bullet-list',
        meta: {
          marker: requiredChoice(node.attributes, 'marker', ['-', '+', '*']),
          loose: requiredBoolean(node.attributes, 'loose'),
        },
        children: requireNamed(childStates(), 'list-item'),
      }
    case 'task-list':
      return {
        name: 'task-list',
        meta: {
          marker: requiredChoice(node.attributes, 'marker', ['-', '+', '*']),
          loose: requiredBoolean(node.attributes, 'loose'),
        },
        children: requireNamed(childStates(), 'task-list-item'),
      }
    case 'table':
      if (!descendants.length)
        throw new Error('table must contain a header row')
      return {
        name: 'table',
        children: requireNamed(childStates(), 'table.row'),
      }
    case 'table.row':
      if (!descendants.length) throw new Error('table row must contain a cell')
      return {
        name: 'table.row',
        children: requireNamed(childStates(), 'table.cell'),
      }
    case 'paragraph':
      return {
        name: 'paragraph',
        text: inlineText(node, descendants, labels, children),
      }
    case 'atx-heading': {
      const level = requiredNumber(node.attributes, 'level')
      if (!Number.isInteger(level) || level < 1 || level > 6)
        throw new Error('ATX heading level must be an integer from 1 to 6')
      const text = inlineText(node, descendants, labels, children)
      return {
        name: 'atx-heading',
        meta: { level },
        text: descendants.length
          ? `${'#'.repeat(level)} ${text}`
          : node.content || `${'#'.repeat(level)} `,
      }
    }
    case 'setext-heading': {
      const level = requiredNumber(node.attributes, 'level')
      const underline = requiredString(node.attributes, 'underline')
      if (
        (level !== 1 && level !== 2) ||
        !/^(=+|-+)$/.test(underline) ||
        (level === 1) !== underline.startsWith('=')
      )
        throw new Error('setext heading level and underline do not match')
      return {
        name: 'setext-heading',
        meta: { level, underline },
        text: inlineText(node, descendants, labels, children),
      }
    }
    case 'table.cell':
      return {
        name: 'table.cell',
        meta: {
          align: requiredChoice(node.attributes, 'align', [
            'none',
            'left',
            'center',
            'right',
          ]),
        },
        text: inlineText(node, descendants, labels, children),
      }
    case 'thematic-break':
      noChildren(node, descendants)
      return { name: 'thematic-break', text: node.content }
    case 'code-block':
      noChildren(node, descendants)
      {
        const fenceLength = optionalNumber(node.attributes, 'fenceLength')
        if (
          fenceLength !== undefined &&
          (!Number.isInteger(fenceLength) || fenceLength < 3)
        )
          throw new Error('code fence length must be an integer of at least 3')
        const lang = requiredString(node.attributes, 'lang')
        if (/[\r\n]/.test(lang))
          throw new Error('code info string cannot contain line breaks')
        return {
          name: 'code-block',
          meta: {
            type: requiredChoice(node.attributes, 'type', [
              'fenced',
              'indented',
            ]),
            lang,
            ...(fenceLength !== undefined && {
              fenceLength,
            }),
          },
          text: node.content,
        }
      }
    case 'html-block':
      noChildren(node, descendants)
      return { name: 'html-block', text: node.content }
    case 'link-reference-definition':
      noChildren(node, descendants)
      return { name: 'paragraph', text: node.content }
    case 'math-block':
      noChildren(node, descendants)
      return {
        name: 'math-block',
        meta: {
          mathStyle: requiredChoice(node.attributes, 'mathStyle', [
            '',
            'gitlab',
          ]),
        },
        text: node.content,
      }
    case 'frontmatter':
      noChildren(node, descendants)
      {
        const lang = requiredChoice(node.attributes, 'lang', [
          'yaml',
          'toml',
          'json',
        ])
        const style = requiredChoice(node.attributes, 'style', [
          '-',
          '+',
          ';',
          '{',
        ])
        if (
          (lang === 'yaml' && style !== '-') ||
          (lang === 'toml' && style !== '+') ||
          (lang === 'json' && style !== ';' && style !== '{')
        )
          throw new Error(
            'frontmatter language and delimiter style do not match'
          )
        return {
          name: 'frontmatter',
          meta: { lang, style },
          text: node.content,
        }
      }
    case 'diagram':
      noChildren(node, descendants)
      {
        const type = requiredChoice(node.attributes, 'type', [
          'mermaid',
          'plantuml',
          'vega-lite',
          'flowchart',
          'sequence',
        ])
        const lang = requiredString(node.attributes, 'lang')
        if (lang !== (type === 'vega-lite' ? 'json' : 'yaml'))
          throw new Error('diagram language does not match its type')
        return {
          name: 'diagram',
          meta: { lang, type },
          text: node.content,
        }
      }
    case 'footnote': {
      const identifier = requiredString(node.attributes, 'identifier')
      if (!identifier || /[\r\n[\]]/.test(identifier))
        throw new Error('invalid footnote identifier')
      return {
        name: 'footnote',
        meta: { identifier },
        children: childStates(),
      }
    }
    case 'document':
      throw new Error('document root cannot be nested')
    case 'opaque':
      noChildren(node, descendants)
      return { name: 'opaque', text: node.content }
    default:
      throw new Error(`unsupported document body node type ${node.type}`)
  }
}

function inlineText(
  parent: DocumentBodyNode,
  children: DocumentBodyNode[],
  labels: Labels,
  getChildren: (parentID: string) => DocumentBodyNode[]
): string {
  if (!children.length) return parent.content
  const nodes: InlineNode[] = children.map((node) => {
    if (getChildren(node.nodeID).length)
      throw new Error(`inline node ${node.nodeID} cannot have children`)
    const attributes = inlineAttributes(node.attributes)
    switch (node.type) {
      case 'run':
        return { type: 'run', content: node.content, attributes }
      case 'image':
        return { type: 'image', attributes }
      case 'mention':
        return { type: 'mention', attributes }
      case 'math':
        return { type: 'math', content: node.content, attributes }
      case 'line-break':
        return { type: 'line-break', attributes }
      case 'opaque-inline':
        return { type: 'opaque-inline', content: node.content, attributes }
      default:
        throw new Error(
          `invalid inline node type ${node.type} in ${parent.type}`
        )
    }
  })
  return inlineNodesToMarkdown(nodes, { labels })
}

function collectLabels(nodes: DocumentBodyNode[]): Labels {
  const labels: Labels = new Map()
  for (const node of nodes) {
    if (node.type !== 'link-reference-definition') continue
    const definition = beginRules.reference_definition.exec(node.content)
    if (!definition) continue
    const label = `${definition[2]}${definition[3]}`.toLowerCase()
    if (!labels.has(label))
      labels.set(label, { href: definition[6]!, title: definition[10] || '' })
  }
  return labels
}

function inlineAttributes(
  attributes: Record<string, unknown>
): InlineAttributes {
  const result: InlineAttributes = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value !== 'boolean' && typeof value !== 'string')
      throw new Error(`invalid inline attribute ${key}`)
    result[key] = value
  }
  return result
}

function requireNamed<N extends TState['name']>(
  states: TState[],
  name: N
): Extract<TState, { name: N }>[] {
  return states.map((state) => {
    if (state.name !== name)
      throw new Error(`expected ${name} child state, received ${state.name}`)
    return state as Extract<TState, { name: N }>
  })
}

function requiredString(attributes: Record<string, unknown>, key: string) {
  const value = attributes[key]
  if (typeof value !== 'string')
    throw new Error(`missing string attribute ${key}`)
  return value
}

function requiredNumber(attributes: Record<string, unknown>, key: string) {
  const value = attributes[key]
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`missing numeric attribute ${key}`)
  return value
}

function requiredBoolean(attributes: Record<string, unknown>, key: string) {
  const value = attributes[key]
  if (typeof value !== 'boolean')
    throw new Error(`missing boolean attribute ${key}`)
  return value
}

function requiredChoice<const Values extends readonly string[]>(
  attributes: Record<string, unknown>,
  key: string,
  choices: Values
): Values[number] {
  const value = attributes[key]
  if (typeof value !== 'string' || !choices.includes(value))
    throw new Error(`invalid ${key} attribute`)
  return value as Values[number]
}

function optionalNumber(attributes: Record<string, unknown>, key: string) {
  const value = attributes[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`invalid numeric attribute ${key}`)
  return value
}

function noChildren(node: DocumentBodyNode, descendants: DocumentBodyNode[]) {
  if (descendants.length)
    throw new Error(`${node.type} cannot contain child nodes`)
}
