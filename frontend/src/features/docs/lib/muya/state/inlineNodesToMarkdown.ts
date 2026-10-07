import { tokenizer, tokensToPlainText } from '../inlineRenderer/lexer'
import type { Labels, Token } from '../inlineRenderer/types'
import type { InlineAttributes, InlineNode } from './markdownToInlineNodes'

type Mark = 'bold' | 'italic' | 'strike'
type ActiveMark = { mark: Mark; delimiter: string }

export function inlineNodesToMarkdown(
  nodes: InlineNode[],
  options: { labels?: Labels } = {}
): string {
  const output: string[] = []

  for (let index = 0; index < nodes.length; ) {
    const node = nodes[index]!
    if (node.type === 'run' && typeof node.attributes.linkSource === 'string') {
      const group = [node]
      let next = index + 1
      while (
        next < nodes.length &&
        nodes[next]!.type === 'run' &&
        sameLink(node.attributes, nodes[next]!.attributes)
      ) {
        group.push(nodes[next] as Extract<InlineNode, { type: 'run' }>)
        next++
      }
      output.push(serializeLink(group, options.labels))
      index = next
      continue
    }

    if (node.type === 'run' && typeof node.attributes.href !== 'string') {
      const group = [node]
      let next = index + 1
      while (
        next < nodes.length &&
        nodes[next]!.type === 'run' &&
        typeof nodes[next]!.attributes.href !== 'string' &&
        typeof nodes[next]!.attributes.linkSource !== 'string'
      ) {
        group.push(nodes[next] as Extract<InlineNode, { type: 'run' }>)
        next++
      }
      output.push(serializeRuns(group, false))
      index = next
      continue
    }

    output.push(serializeNode(node, options.labels))
    index++
  }

  return output.join('')
}

function serializeNode(node: InlineNode, labels?: Labels): string {
  switch (node.type) {
    case 'run': {
      const inner = serializeRuns([node], Boolean(node.attributes.href))
      if (
        typeof node.attributes.href !== 'string' ||
        node.attributes.linkSource
      )
        return inner
      if (isMatchingAutolink(node, labels)) return sourceOf(node.attributes)!
      return formatLink(inner, node.attributes.href, node.attributes.linkTitle)
    }
    case 'mention': {
      const { kind, id, label } = node.attributes
      if (kind === 'document') return `[${label}](/docs/${id})`
      if (kind === 'project') return `[${label}](/projects/${id})`
      return `@${label}`
    }
    case 'image': {
      const source = matchingImageSource(node.attributes, labels)
      const image = source ?? formatImage(node.attributes)
      return typeof node.attributes.href === 'string'
        ? formatLink(image, node.attributes.href, node.attributes.linkTitle)
        : image
    }
    case 'math': {
      const tokens = sourceTokens(node.attributes, labels)
      if (
        tokens?.length === 1 &&
        tokens[0]!.type === 'inline_math' &&
        tokens[0]!.content === node.content
      )
        return sourceOf(node.attributes)!
      if (node.content.includes('\n'))
        throw new Error('inline math cannot contain a line break in Muya')
      const marker = node.attributes.marker === '$$' ? '$$' : '$'
      const content = node.content.replace(/(?<!\\)\$/g, '\\$')
      return `${marker}${content}${marker}`
    }
    case 'line-break': {
      const tokens = sourceTokens(node.attributes, labels)
      if (
        tokens?.length === 1 &&
        (tokens[0]!.type === 'soft_line_break' ||
          tokens[0]!.type === 'hard_line_break') &&
        (tokens[0]!.type === 'hard_line_break') ===
          (node.attributes.hard === true)
      )
        return sourceOf(node.attributes)!
      return node.attributes.hard === true ? '  \n' : '\n'
    }
    case 'opaque-inline':
      return node.content
  }
}

function serializeLink(
  nodes: Extract<InlineNode, { type: 'run' }>[],
  labels?: Labels
) {
  const attributes = nodes[0]!.attributes
  const label = serializeRuns(nodes, true)
  const source =
    typeof attributes.linkSource === 'string'
      ? attributes.linkSource
      : undefined
  const tokens = source ? tokenize(source, labels) : undefined
  const token = tokens?.length === 1 ? tokens[0] : undefined

  if (
    token &&
    (token.type === 'link' || token.type === 'reference_link') &&
    token.anchor === label &&
    linkTargetMatches(token, attributes, labels)
  )
    return source!

  if (typeof attributes.href !== 'string')
    throw new Error('an unresolved reference link cannot be exported')
  return formatLink(label, attributes.href, attributes.linkTitle)
}

function serializeRuns(
  nodes: Extract<InlineNode, { type: 'run' }>[],
  insideLink: boolean
): string {
  const output: string[] = []
  let active: ActiveMark[] = []

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!
    const marks = marksFor(node.attributes)
    let common = 0
    while (
      common < active.length &&
      common < marks.length &&
      active[common]!.mark === marks[common]!.mark &&
      active[common]!.delimiter === marks[common]!.delimiter
    )
      common++

    const nextNode = nodes[index + 1]
    const nextMarks = nextNode ? marksFor(nextNode.attributes) : []
    const openedAtNode = common < marks.length
    const closesAfterNode = !marksArePrefix(marks, nextMarks)
    if (
      marks.length &&
      ((openedAtNode && /^\s/.test(node.content)) ||
        (closesAfterNode && /\s$/.test(node.content)))
    ) {
      for (let i = active.length - 1; i >= 0; i--)
        output.push(active[i]!.delimiter)
      output.push(htmlMarkedRun(node))
      active = []
      continue
    }

    for (let i = active.length - 1; i >= common; i--)
      output.push(active[i]!.delimiter)
    for (let i = common; i < marks.length; i++) output.push(marks[i]!.delimiter)

    output.push(wrapHtmlMarks(node, runContent(node, insideLink)))
    active = marks
  }

  for (let i = active.length - 1; i >= 0; i--) output.push(active[i]!.delimiter)
  return output.join('')
}

/** Underline and highlight have no Markdown syntax: they are written as inline HTML. */
function wrapHtmlMarks(
  node: Extract<InlineNode, { type: 'run' }>,
  text: string
) {
  let wrapped = text
  if (node.attributes.underline === true) wrapped = `<u>${wrapped}</u>`
  if (node.attributes.highlight === true) wrapped = `<mark>${wrapped}</mark>`
  return wrapped
}

function runContent(
  node: Extract<InlineNode, { type: 'run' }>,
  insideLink: boolean
): string {
  const tokens = sourceTokens(node.attributes)
  const source = sourceOf(node.attributes)

  if (node.attributes.code === true) {
    if (
      tokens?.length === 1 &&
      tokens[0]!.type === 'inline_code' &&
      tokens[0]!.content === node.content
    )
      return source!
    return formatCode(node.content)
  }

  if (
    tokens &&
    tokensToPlainText(tokens) === node.content &&
    tokens.every((token) =>
      insideLink
        ? isPlainTextToken(token)
        : isPlainTextToken(token) || isAutolinkToken(token)
    ) &&
    (!tokens.some(isAutolinkToken) || isMatchingAutolink(node))
  )
    return source!

  return escapeText(node.content)
}

function marksFor(attributes: InlineAttributes): ActiveMark[] {
  return (['bold', 'italic', 'strike'] as const)
    .filter((mark) => attributes[mark] === true)
    .map((mark) => ({ mark, delimiter: markDelimiter(attributes, mark) }))
}

function marksArePrefix(left: ActiveMark[], right: ActiveMark[]): boolean {
  return (
    left.length <= right.length &&
    left.every(
      (mark, index) =>
        mark.mark === right[index]!.mark &&
        mark.delimiter === right[index]!.delimiter
    )
  )
}

function markDelimiter(attributes: InlineAttributes, mark: Mark): string {
  const marker = attributes[`${mark}Marker`]
  if (typeof marker === 'string' && marker.length) return marker
  return mark === 'bold' ? '**' : mark === 'italic' ? '*' : '~~'
}

function sourceTokens(attributes: InlineAttributes, labels?: Labels) {
  const source = sourceOf(attributes)
  return source ? tokenize(source, labels) : undefined
}

function sourceOf(attributes: InlineAttributes): string | undefined {
  return typeof attributes.source === 'string' ? attributes.source : undefined
}

function tokenize(source: string, labels?: Labels): Token[] {
  return tokenizer(source, {
    labels,
    options: { superSubScript: true, footnote: true },
  })
}

function isPlainTextToken(token: Token): boolean {
  return (
    token.type === 'text' ||
    token.type === 'backlash' ||
    token.type === 'html_escape'
  )
}

function isAutolinkToken(
  token: Token
): token is Extract<Token, { type: 'auto_link' | 'auto_link_extension' }> {
  return token.type === 'auto_link' || token.type === 'auto_link_extension'
}

function isMatchingAutolink(
  node: Extract<InlineNode, { type: 'run' }>,
  labels?: Labels
): boolean {
  if (typeof node.attributes.href !== 'string') return false
  const tokens = sourceTokens(node.attributes, labels)
  return (
    tokens?.length === 1 &&
    isAutolinkToken(tokens[0]!) &&
    tokensToPlainText(tokens) === node.content &&
    autolinkTarget(tokens[0]!) === node.attributes.href
  )
}

function autolinkTarget(
  token: Extract<Token, { type: 'auto_link' | 'auto_link_extension' }>
): string {
  if (token.type === 'auto_link') return token.href
  return token.url || token.email
}

function linkTargetMatches(
  token: Extract<Token, { type: 'link' | 'reference_link' }>,
  attributes: InlineAttributes,
  labels?: Labels
): boolean {
  if (token.type === 'link')
    return (
      token.href === attributes.href &&
      (token.title || undefined) === (attributes.linkTitle || undefined)
    )

  const label = token.label.toLowerCase()
  const definition = labels?.get(label)
  return (
    token.label === attributes.referenceLabel &&
    definition?.href === attributes.href &&
    definition.title === attributes.linkTitle
  )
}

function matchingImageSource(
  attributes: InlineAttributes,
  labels?: Labels
): string | undefined {
  const source = sourceOf(attributes)
  if (!source) return undefined
  const tokens = tokenize(source, labels)
  if (tokens.length !== 1) return undefined
  const token = tokens[0]!
  if (token.type === 'image')
    return token.src === attributes.src &&
      token.alt === attributes.alt &&
      (token.title || undefined) === attributes.title
      ? source
      : undefined
  if (token.type === 'reference_image') {
    const definition = labels?.get(token.label.toLowerCase())
    return token.label === attributes.referenceLabel &&
      definition?.href === attributes.src &&
      definition.title === attributes.title &&
      token.alt === attributes.alt
      ? source
      : undefined
  }
  return undefined
}

function sameLink(left: InlineAttributes, right: InlineAttributes): boolean {
  return (
    left.href === right.href &&
    left.linkTitle === right.linkTitle &&
    left.linkSource === right.linkSource &&
    left.referenceLabel === right.referenceLabel
  )
}

function formatLink(label: string, href: string, title?: boolean | string) {
  const target = escapeDestination(href)
  const titlePart =
    typeof title === 'string' && title.length ? ` "${escapeTitle(title)}"` : ''
  return `[${label}](${target}${titlePart})`
}

function formatImage(attributes: InlineAttributes): string {
  if (typeof attributes.src !== 'string' || typeof attributes.alt !== 'string')
    throw new Error('image AST node requires src and alt attributes')
  const title =
    typeof attributes.title === 'string'
      ? ` "${escapeTitle(attributes.title)}"`
      : ''
  return `![${attributes.alt.replace(/[\\\x5b\x5d]/g, '\\$&')}](${escapeDestination(attributes.src)}${title})`
}

function formatCode(content: string): string {
  if (content.includes('\n'))
    throw new Error('inline code cannot contain a line break in Muya')
  const runs = content.match(/`+/g) ?? []
  const marker = '`'.repeat(Math.max(1, ...runs.map((run) => run.length + 1)))
  if (marker.length > 3)
    throw new Error(
      'Muya cannot represent edited inline code with three backticks'
    )
  const padding = content.startsWith(' ') || content.endsWith(' ') ? ' ' : ''
  return `${marker}${padding}${content}${padding}${marker}`
}

function escapeText(content: string): string {
  return content.replace(/&/g, '&amp;').replace(/[\\`*_{}\x5b\x5d<>|]/g, '\\$&')
}

function escapeDestination(value: string): string {
  if (/[\n\r<>]/.test(value))
    throw new Error('Muya cannot represent this Markdown link destination')
  return value.replace(/([\\()])/g, '\\$1').replace(/ /g, '%20')
}

function escapeTitle(value: string): string {
  if (/[\n\r]/.test(value))
    throw new Error('Muya cannot represent a multiline Markdown title')
  return value.replace(/[\\"]/g, '\\$&')
}

function htmlMarkedRun(node: Extract<InlineNode, { type: 'run' }>): string {
  const tags: string[] = marksFor(node.attributes).map(({ mark }) =>
    mark === 'bold' ? 'strong' : mark === 'italic' ? 'em' : 'del'
  )
  if (node.attributes.code === true) tags.push('code')
  const content =
    node.attributes.code === true
      ? escapeHtml(node.content)
      : escapeText(node.content)
  return `${tags.map((tag) => `<${tag}>`).join('')}${content}${tags
    .reverse()
    .map((tag) => `</${tag}>`)
    .join('')}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
