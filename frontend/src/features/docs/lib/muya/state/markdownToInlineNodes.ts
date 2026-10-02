import { tokenizer, tokensToPlainText } from '../inlineRenderer/lexer'
import type { ITokenizerOptions, Labels, Token } from '../inlineRenderer/types'

export type InlineAttributes = Record<string, boolean | string>

export type InlineNode =
  | { type: 'run'; content: string; attributes: InlineAttributes }
  | { type: 'image'; attributes: InlineAttributes }
  | { type: 'math'; content: string; attributes: InlineAttributes }
  | { type: 'line-break'; attributes: InlineAttributes }
  | { type: 'opaque-inline'; content: string; attributes: InlineAttributes }

export function markdownToInlineNodes(
  source: string,
  options: { hasBeginRules?: boolean; labels?: Labels } = {}
): InlineNode[] {
  const tokens = tokenizer(source, {
    ...options,
    hasBeginRules: options.hasBeginRules ?? false,
    options: { superSubScript: true, footnote: true },
  } satisfies ITokenizerOptions)
  return mergeAdjacentRuns(projectTokens(tokens, {}, options.labels))
}

function mergeAdjacentRuns(nodes: InlineNode[]): InlineNode[] {
  const merged: InlineNode[] = []
  for (const node of nodes) {
    const previous = merged.at(-1)
    if (
      node.type === 'run' &&
      previous?.type === 'run' &&
      sameRunMarks(previous.attributes, node.attributes)
    ) {
      previous.content += node.content
      previous.attributes.source =
        ((previous.attributes.source as string | undefined) ?? '') +
        ((node.attributes.source as string | undefined) ?? '')
    } else {
      merged.push(node)
    }
  }
  return merged
}

function sameRunMarks(
  left: InlineAttributes,
  right: InlineAttributes
): boolean {
  const { source: _leftSource, ...leftMarks } = left
  const { source: _rightSource, ...rightMarks } = right
  return JSON.stringify(leftMarks) === JSON.stringify(rightMarks)
}

function projectTokens(
  tokens: Token[],
  inherited: InlineAttributes,
  labels?: Labels
): InlineNode[] {
  const nodes: InlineNode[] = []
  let escapedSourcePrefix = ''
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'emoji':
      case 'html_escape':
      case 'auto_link_extension':
      case 'auto_link': {
        const attributes = { ...inherited }
        let text = tokensToPlainText([token])
        if (token.type === 'auto_link_extension')
          attributes.href = token.url || token.email
        if (token.type === 'auto_link' && token.isLink)
          attributes.href = token.href
        if (text) {
          nodes.push({
            type: 'run',
            content: text,
            attributes: {
              ...attributes,
              source: escapedSourcePrefix + token.raw,
            },
          })
          escapedSourcePrefix = ''
        }
        break
      }
      case 'strong':
        nodes.push(
          ...projectTokens(
            token.children,
            {
              ...inherited,
              bold: true,
              boldMarker: token.marker,
            },
            labels
          )
        )
        break
      case 'em':
        nodes.push(
          ...projectTokens(
            token.children,
            {
              ...inherited,
              italic: true,
              italicMarker: token.marker,
            },
            labels
          )
        )
        break
      case 'del':
        nodes.push(
          ...projectTokens(
            token.children,
            {
              ...inherited,
              strike: true,
              strikeMarker: token.marker,
            },
            labels
          )
        )
        break
      case 'inline_code':
        nodes.push({
          type: 'run',
          content: token.content,
          attributes: {
            ...inherited,
            source: token.raw,
            code: true,
            codeMarker: token.marker,
          },
        })
        break
      case 'link':
        nodes.push(
          ...projectTokens(
            token.children,
            {
              ...inherited,
              href: token.href,
              linkTitle: token.title,
              linkSource: token.raw,
            },
            labels
          )
        )
        break
      case 'reference_link': {
        const resolved = labels?.get(token.label.toLowerCase())
        nodes.push(
          ...projectTokens(
            token.children,
            {
              ...inherited,
              ...(resolved && {
                href: resolved.href,
                linkTitle: resolved.title,
              }),
              referenceLabel: token.label,
              linkSource: token.raw,
            },
            labels
          )
        )
        break
      }
      case 'image':
        nodes.push({
          type: 'image',
          attributes: {
            ...inherited,
            src: token.src,
            alt: token.alt,
            title: token.title,
            source: token.raw,
          },
        })
        break
      case 'reference_image': {
        const resolved = labels?.get(token.label.toLowerCase())
        nodes.push({
          type: 'image',
          attributes: {
            ...inherited,
            ...(resolved && {
              src: resolved.href,
              title: resolved.title,
            }),
            alt: token.alt,
            referenceLabel: token.label,
            source: token.raw,
          },
        })
        break
      }
      case 'inline_math':
        nodes.push({
          type: 'math',
          content: token.content,
          attributes: { ...inherited, marker: token.marker, source: token.raw },
        })
        break
      case 'soft_line_break':
      case 'hard_line_break':
        nodes.push({
          type: 'line-break',
          attributes: {
            ...inherited,
            hard: token.type === 'hard_line_break',
            source: token.raw,
          },
        })
        break
      case 'html_tag': {
        const mark = htmlMark(token.tag)
        if (mark && token.children)
          nodes.push(
            ...projectTokens(token.children, { ...inherited, ...mark }, labels)
          )
        else
          nodes.push({
            type: 'opaque-inline',
            content: token.raw,
            attributes: {},
          })
        break
      }
      case 'super_sub_script':
      case 'footnote_identifier':
        nodes.push({
          type: 'opaque-inline',
          content: token.raw,
          attributes: {},
        })
        break
      case 'backlash':
        escapedSourcePrefix += token.raw
        break
      case 'tail_header':
      case 'header':
      case 'hr':
      case 'code_fence':
      case 'multiple_math':
      case 'reference_definition':
        // These tokens encode block syntax, delimiters, or syntax already
        // represented by adjacent visible tokens.
        break
      default:
        unhandledToken(token)
    }
  }
  return nodes
}

function unhandledToken(token: never): never {
  throw new Error(`unsupported Muya inline token: ${String(token)}`)
}

function htmlMark(tag: string): InlineAttributes | undefined {
  switch (tag.toLowerCase()) {
    case 'b':
    case 'strong':
      return { bold: true }
    case 'i':
    case 'em':
      return { italic: true }
    case 's':
    case 'del':
    case 'strike':
      return { strike: true }
    case 'code':
      return { code: true }
    default:
      return undefined
  }
}
