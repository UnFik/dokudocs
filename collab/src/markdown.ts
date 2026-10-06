// Markdown derived from the document JSON. The JSON is the source of truth;
// this text keeps list previews, search and exports working without reading it.

type Mark = { type: string; attrs?: Record<string, unknown> }
type JSONNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: JSONNode[]
  text?: string
  marks?: Mark[]
}

function attributesOf(node: JSONNode): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(node.attrs?.bodyAttributes ?? '{}'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function plainText(node: JSONNode): string {
  if (node.text !== undefined) return node.text
  return (node.content ?? []).map(plainText).join('')
}

function wrapText(node: JSONNode): string {
  const marks = node.marks ?? []
  // Text only proposed by a suggestion is not part of the document yet.
  if (marks.some((mark) => mark.type === 'suggestion_insert')) return ''
  let value = node.text ?? ''
  for (const mark of marks) {
    if (mark.type === 'code') value = `\`${value}\``
    else if (mark.type === 'strong') value = `**${value}**`
    else if (mark.type === 'em') value = `*${value}*`
    else if (mark.type === 'strike') value = `~~${value}~~`
    // No Markdown syntax: written as inline HTML.
    else if (mark.type === 'underline') value = `<u>${value}</u>`
    else if (mark.type === 'highlight') value = `<mark>${value}</mark>`
    else if (mark.type === 'link') {
      const title = mark.attrs?.title ? ` "${String(mark.attrs.title)}"` : ''
      value = `[${value}](${String(mark.attrs?.href ?? '')}${title})`
    }
  }
  return value
}

function inline(nodes: JSONNode[] = []): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return wrapText(node)
        case 'run':
          return inline(node.content)
        case 'image': {
          const attributes = attributesOf(node)
          return `![${String(attributes.alt ?? '')}](${String(attributes.src ?? '')})`
        }
        case 'line_break':
          return attributesOf(node).hard === false ? '\n' : '  \n'
        case 'math':
          return `$${plainText(node)}$`
        case 'opaque_inline':
          return String(node.attrs?.bodyContent ?? '')
        default:
          return plainText(node)
      }
    })
    .join('')
}

function fence(lang: string, body: string) {
  return `\`\`\`${lang}\n${body}\n\`\`\``
}

function indent(text: string, spaces: number) {
  const pad = ' '.repeat(spaces)
  return text
    .split('\n')
    .map((line, index) => (index === 0 || line === '' ? line : pad + line))
    .join('\n')
}

function listItem(node: JSONNode, marker: string): string {
  const inner = blocks(node.content, '\n')
  return `${marker}${indent(inner, marker.length)}`
}

function table(node: JSONNode): string {
  const rows = (node.content ?? []).map((row) => (row.content ?? []).map((cell) => inline(cell.content).replaceAll('|', '\\|')))
  if (!rows.length) return ''
  const width = Math.max(...rows.map((row) => row.length))
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, index) => cells[index] ?? '').join(' | ')} |`
  return [line(rows[0]!), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n')
}

function block(node: JSONNode): string {
  const attributes = attributesOf(node)
  switch (node.type) {
    case 'paragraph':
      return inline(node.content)
    case 'atx_heading':
    case 'setext_heading': {
      const level = Math.min(6, Math.max(1, Number(attributes.level) || 1))
      return `${'#'.repeat(level)} ${inline(node.content)}`
    }
    case 'thematic_break':
      return '---'
    case 'code_block':
      return fence(String(attributes.lang ?? ''), plainText(node))
    case 'html_block':
    case 'link_reference_definition':
      return plainText(node)
    case 'math_block':
      return `$$\n${plainText(node)}\n$$`
    case 'frontmatter':
      return `---\n${plainText(node)}\n---`
    case 'diagram':
      return fence(String(attributes.type ?? 'mermaid'), plainText(node))
    case 'block_quote':
      return blocks(node.content, '\n\n')
        .split('\n')
        .map((line) => (line === '' ? '>' : `> ${line}`))
        .join('\n')
    case 'bullet_list':
      return (node.content ?? []).map((item) => listItem(item, '- ')).join('\n')
    case 'order_list': {
      const start = Number(attributes.start) || 1
      return (node.content ?? []).map((item, index) => listItem(item, `${start + index}. `)).join('\n')
    }
    case 'task_list':
      return (node.content ?? [])
        .map((item) => listItem(item, attributesOf(item).checked ? '- [x] ' : '- [ ] '))
        .join('\n')
    case 'table':
      return table(node)
    case 'footnote':
      return `[^${String(attributes.identifier ?? '')}]: ${indent(blocks(node.content, '\n'), 4)}`
    case 'opaque':
      return String(node.attrs?.bodyContent ?? '')
    default:
      return plainText(node)
  }
}

function blocks(nodes: JSONNode[] = [], separator: string): string {
  return nodes.map(block).join(separator)
}

/** The Markdown of a document's JSON; empty for a document with no blocks. */
export function toMarkdown(json: unknown): string {
  const root = json as JSONNode
  const body = root.content?.[0]
  const text = blocks(body?.content, '\n\n')
  return text === '' ? '' : `${text}\n`
}
