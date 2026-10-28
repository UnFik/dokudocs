import { createHash } from 'node:crypto'

// The Agent's content edits (ADR 0043). They are targeted operations, applied to
// the document as the editor stores it, so they meet whoever is typing in the
// room like the edit of one more person. In suggest mode the result carries only
// suggestions in the author's name, and passes the same check as a person's.

export type MarkdownOperation =
  | { type: 'replace_text'; find: string; replace: string }
  | { type: 'insert_after_heading'; heading: string; text: string }
  | { type: 'append_section'; heading: string; level?: number; text: string }
  | { type: 'append'; text: string }
  | { type: 'insert_before_heading'; heading: string; text: string }
  | { type: 'replace_section'; heading: string; text: string }
  | { type: 'replace_range'; from: string; to?: string; text: string }
  | { type: 'delete_section'; heading: string }

export type SourceOperation =
  | { type: 'replace_text'; find: string; replace: string }
  | { type: 'replace_all'; text: string }
  | { type: 'append'; text: string }

/** A refusal whose message is safe to hand back to the Agent. */
export class AgentEditError extends Error {}

type Mark = { type: string; attrs?: Record<string, unknown> }
type JSONNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: JSONNode[]
  text?: string
  marks?: Mark[]
}

export type EditOptions = {
  mode: 'direct' | 'suggest'
  /** The User the edit is for: suggestions carry their name. */
  author: string
  /** A fresh UUID each call, for node and suggestion ids. */
  newID: () => string
}

/** A short fingerprint of the text the Agent read; an edit naming another one is refused. */
export function textVersion(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

const textBlocks = new Set(['paragraph', 'atx_heading', 'setext_heading'])
const headings = new Set(['atx_heading', 'setext_heading'])

function plain(node: JSONNode): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(plain).join('')
}

/** Canonical text only: what a reader sees once proposed insertions are set aside. */
function canonical(node: JSONNode): string {
  if (node.type === 'text') return node.marks?.some((mark) => mark.type === 'suggestion_insert') ? '' : (node.text ?? '')
  return (node.content ?? []).map(canonical).join('')
}

function body(json: JSONNode): JSONNode[] {
  const root = json.content?.[0]
  if (!root || root.type !== 'document') throw new AgentEditError('the document has an unexpected shape')
  root.content ??= []
  return root.content
}

function walkRuns(nodes: JSONNode[], visit: (run: JSONNode) => void) {
  for (const node of nodes) {
    if (node.type === 'run') visit(node)
    else if (node.content) walkRuns(node.content, visit)
  }
}

const node = (type: string, id: string, attributes: Record<string, unknown>, content: JSONNode[]): JSONNode => ({
  type,
  attrs: { nodeID: id, bodyAttributes: JSON.stringify(attributes), bodyContent: '' },
  content,
})

type Align = 'none' | 'left' | 'center' | 'right'
type ListItem = { checked?: boolean; children: ParsedBlock[] }

/** The blocks a text can hold. Containers (quote, list, notice) hold blocks themselves. */
export type ParsedBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'code_block'; lang: string; text: string }
  | { type: 'diagram'; text: string }
  | { type: 'atx_heading'; text: string; level: number }
  | { type: 'thematic_break' }
  | { type: 'block_quote'; children: ParsedBlock[] }
  | { type: 'notice'; variant: string; children: ParsedBlock[] }
  | { type: 'list'; kind: 'bullet' | 'order' | 'task'; start: number; items: ListItem[] }
  | { type: 'table'; rows: string[][]; aligns: Align[] }

export type TextBlock = ParsedBlock

type Fence = { char: string; length: number; indent: number; lang: string }

const indentOf = (line: string) => /^ */.exec(line)![0].length

/** Three or more backticks or tildes, up to three spaces in; the language is the first word after them. */
function openingFence(line: string): Fence | null {
  const indent = indentOf(line)
  const rest = line.slice(indent)
  if (indent > 3 || rest.length < 3 || (rest[0] !== '`' && rest[0] !== '~')) return null
  let length = 0
  while (rest[length] === rest[0]) length++
  if (length < 3) return null
  const info = rest.slice(length).trim()
  // A backtick fence whose info string holds a backtick is inline code, not a fence.
  if (rest[0] === '`' && info.includes('`')) return null
  return { char: rest[0]!, length, indent, lang: info.split(/\s+/)[0] ?? '' }
}

/** The same character, at least as long, and nothing after it. */
function closesFence(fence: Fence, line: string): boolean {
  const indent = indentOf(line)
  const rest = line.slice(indent).replace(/[ \t]+$/, '')
  return indent <= 3 && rest.length >= fence.length && [...rest].every((char) => char === fence.char)
}

/**
 * Splits the text an Agent writes into blocks: fenced code (kept exactly as written, blank
 * lines and indentation included), quotes, lists, tables, notices and separators; other lines
 * are paragraphs that end at a blank line. The same rules, and the same cases (backend/internal/application/agent/testdata),
 * as create_document in the backend, so both ways of writing read the same.
 */
export function blocksOf(text: string): TextBlock[] {
  return parseBlocks(text, false) as TextBlock[]
}


const headingLine = /^(#{1,6})[ \t]+(.+?)[ \t#]*$/

/**
 * Like blocksOf, and a line that starts with one to six # and a space is a heading of that
 * level. It rewrites existing text, where the Agent turns plain lines into headings and code.
 */
export function richBlocksOf(text: string): ParsedBlock[] {
  return parseBlocks(text, true)
}

const thematicBreak = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const listMarker = /^( {0,3})([-*+]|\d{1,9}[.)])(?:( +)(.*))?$/
const quoteLine = /^ {0,3}>/
const noticeLine = /^:::(info|success|warning|tip)?[ \t]*$/
const taskItem = /^\[([ xX])\](?:[ \t]+(.*))?$/
const tableDelimiter = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/

/** The cells of a table row; a pipe after a backslash is text. */
function splitRow(line: string): string[] {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1)
  const cells: string[] = []
  let cell = ''
  for (let at = 0; at < text.length; at++) {
    if (text[at] === '\\' && text[at + 1] === '|') {
      cell += '|'
      at++
    } else if (text[at] === '|') {
      cells.push(cell.trim())
      cell = ''
    } else cell += text[at]
  }
  cells.push(cell.trim())
  return cells
}

const alignOf = (cell: string): Align => {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  return left && right ? 'center' : left ? 'left' : right ? 'right' : 'none'
}

/** Whether a list marker line may start a list in the middle of a paragraph: a bullet, or a number one, with text. */
const interrupts = (marker: RegExpExecArray) => (marker[4] ?? '') !== '' && (!/^\d/.test(marker[2]!) || /^0*1[.)]$/.test(marker[2]!))

/** A list starting at `start`; items of one kind (bullet, number, task) make one list, a change of kind starts the next. */
function parseList(lines: string[], start: number, withHeadings: boolean): { lists: ParsedBlock[]; next: number } {
  const lists: ParsedBlock[] = []
  const ordered = /^\d/.test(listMarker.exec(lines[start]!)![2]!)
  let i = start
  while (i < lines.length) {
    const marker = listMarker.exec(lines[i]!)
    if (!marker || /^\d/.test(marker[2]!) !== ordered || thematicBreak.test(lines[i]!)) break
    const markerIndent = marker[1]!.length
    const first = marker[4] ?? ''
    const spaces = (marker[3] ?? '').length
    const offset = markerIndent + marker[2]!.length + (first !== '' && spaces <= 4 ? spaces : 1)
    const itemLines = [first]
    let j = i + 1
    while (j < lines.length) {
      const line = lines[j]!
      if (line.trim() === '') {
        let k = j
        while (k < lines.length && lines[k]!.trim() === '') k++
        const after = lines[k]
        const nested = after !== undefined && (indentOf(after) >= offset || (indentOf(after) > markerIndent && listMarker.test(after)))
        if (!nested) break
        for (; j < k; j++) itemLines.push('')
        continue
      }
      const indent = indentOf(line)
      const sibling = listMarker.exec(line)
      if (indent >= offset) itemLines.push(line.slice(offset))
      else if (sibling && indent > markerIndent && !thematicBreak.test(line)) itemLines.push(line.slice(indent))
      else if (
        !sibling &&
        itemLines[itemLines.length - 1] !== '' &&
        !openingFence(line) &&
        !quoteLine.test(line) &&
        !thematicBreak.test(line) &&
        !headingLine.test(line.trim())
      )
        itemLines.push(line.trim())
      else break
      j++
    }
    const task = ordered ? null : taskItem.exec(first)
    if (task) itemLines[0] = task[2] ?? ''
    const kind = ordered ? 'order' : task ? 'task' : 'bullet'
    const item: ListItem = { ...(task ? { checked: task[1]!.toLowerCase() === 'x' } : {}), children: parseLines(itemLines, withHeadings) }
    const last = lists[lists.length - 1]
    if (last?.type === 'list' && last.kind === kind) last.items.push(item)
    else lists.push({ type: 'list', kind, start: kind === 'order' ? Number(/^\d+/.exec(marker[2]!)![0]) : 1, items: [item] })
    // The list goes on at a sibling item, after blank lines too.
    let k = j
    while (k < lines.length && lines[k]!.trim() === '') k++
    const following = k < lines.length ? listMarker.exec(lines[k]!) : null
    if (following && following[1]!.length <= markerIndent && /^\d/.test(following[2]!) === ordered) {
      i = k
      continue
    }
    i = j
    break
  }
  return { lists, next: i }
}

function parseBlocks(text: string, withHeadings: boolean): ParsedBlock[] {
  return parseLines(text.replace(/\r\n?/g, '\n').split('\n'), withHeadings)
}

function parseLines(lines: string[], withHeadings: boolean): ParsedBlock[] {
  const blocks: ParsedBlock[] = []
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
    paragraph = []
  }
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    const fence = openingFence(raw)
    if (fence) {
      flush()
      const code: string[] = []
      for (i++; i < lines.length && !closesFence(fence, lines[i]!); i++) code.push(lines[i]!.slice(Math.min(indentOf(lines[i]!), fence.indent)))
      blocks.push(fence.lang === 'mermaid' ? { type: 'diagram', text: code.join('\n') } : { type: 'code_block', lang: fence.lang, text: code.join('\n') })
      continue
    }
    const line = raw.trim()
    const heading = withHeadings ? headingLine.exec(line) : null
    if (line === '') flush()
    else if (heading) {
      flush()
      blocks.push({ type: 'atx_heading', text: heading[2]!, level: heading[1]!.length })
    } else if (thematicBreak.test(raw)) {
      flush()
      blocks.push({ type: 'thematic_break' })
    } else if (quoteLine.test(raw)) {
      flush()
      const quoted: string[] = []
      for (; i < lines.length && quoteLine.test(lines[i]!); i++) quoted.push(lines[i]!.replace(/^ {0,3}> ?/, ''))
      i--
      blocks.push({ type: 'block_quote', children: parseLines(quoted, withHeadings) })
    } else if (noticeLine.test(line) && lines.slice(i + 1).some((later) => later.trim() === ':::')) {
      flush()
      const inner: string[] = []
      const variant = noticeLine.exec(line)![1] ?? 'info'
      for (i++; lines[i]!.trim() !== ':::'; i++) inner.push(lines[i]!)
      blocks.push({ type: 'notice', variant, children: parseLines(inner, withHeadings) })
    } else if (raw.includes('|') && i + 1 < lines.length && lines[i + 1]!.includes('|') && tableDelimiter.test(lines[i + 1]!) && splitRow(raw).length === splitRow(lines[i + 1]!).length) {
      flush()
      const head = splitRow(raw)
      const rows = [head]
      const aligns = splitRow(lines[i + 1]!).map(alignOf)
      for (i += 2; i < lines.length && lines[i]!.trim() !== '' && lines[i]!.includes('|'); i++) {
        const cells = splitRow(lines[i]!)
        rows.push(Array.from({ length: head.length }, (_, at) => cells[at] ?? ''))
      }
      i--
      blocks.push({ type: 'table', rows, aligns })
    } else {
      const marker = listMarker.exec(raw)
      if (marker && (paragraph.length === 0 || interrupts(marker))) {
        flush()
        const { lists, next } = parseList(lines, i, withHeadings)
        blocks.push(...lists)
        i = next - 1
      } else paragraph.push(line)
    }
  }
  flush()
  return blocks
}

const textNode = (value: string): JSONNode[] => (value ? [{ type: 'text', text: value }] : [])

type Span = { text: string; formats: string[]; href?: string; title?: string }

const markOfFormat: Record<string, string> = {
  bold: 'strong',
  italic: 'em',
  strike: 'strike',
  code: 'code',
  underline: 'underline',
  highlight: 'highlight',
}

// The leftmost of: `code`, \escape, [label](address "title"), <address>, a bare address,
// ***both***, **bold**, ~~strike~~, ==highlight==, <u>underline</u>, __bold__, *italic*, _italic_.
const inlineToken = new RegExp(
  [
    '`([^`\\n]+)`',
    '\\\\([\\\\`*_{}\\[\\]()#+\\-.!|~<>=])',
    '\\[([^\\]\\n]+)\\]\\(((?:[^()\\s]|\\([^()\\s]*\\))+)(?:\\s+"([^"]*)")?\\)',
    '<((?:https?://|mailto:)[^>\\s]+)>',
    '(https?://[^\\s<>]+)',
    '\\*\\*\\*([^*\\s](?:[^*]*[^*\\s])?)\\*\\*\\*',
    '\\*\\*([^*\\s](?:[^*]*[^*\\s])?)\\*\\*',
    '~~([^~\\s](?:[^~]*[^~\\s])?)~~',
    '==([^=\\s](?:[^=]*[^=\\s])?)==',
    '<u>([^<\\n]+)</u>',
    '__([^_\\s](?:[^_]*[^_\\s])?)__',
    '\\*([^*\\s](?:[^*]*[^*\\s])?)\\*',
    '_([^_\\s](?:[^_]*[^_\\s])?)_',
  ].join('|')
)

/** The editor's normalizeLinkTarget: only these addresses become links. */
const safeLink = (target: string) => !/[\s<>"]/.test(target) && (/^(https?:|mailto:|tel:|#|\.\.?\/)/i.test(target) || /^\/(?!\/)/.test(target))

const isWord = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}_]/u.test(char)

/** A bare address ends before the punctuation that follows it in a sentence, and before a closing bracket it did not open. */
function bareAddress(value: string): string {
  let end = value.length
  for (;;) {
    const last = value[end - 1]
    const opens = value.slice(0, end).split('(').length - 1
    const closes = value.slice(0, end).split(')').length - 1
    if (last !== undefined && (/[.,;:!?'"*_~]/.test(last) || (last === ')' && closes > opens))) end--
    else return value.slice(0, end)
  }
}

function spansOf(text: string, formats: string[] = [], href?: string, title?: string): Span[] {
  const spans: Span[] = []
  const plain = (value: string, extra: string[] = []) => value && spans.push({ text: value, formats: [...formats, ...extra], href, title })
  while (text) {
    const m = inlineToken.exec(text)
    if (!m) {
      plain(text)
      break
    }
    let end = m.index + m[0].length
    const before = text.slice(0, m.index)
    const inner = (value: string, ...extra: string[]) => spans.push(...spansOf(value, [...formats, ...extra], href, title))
    if (m[1] !== undefined) {
      if ((m.index > 0 && text[m.index - 1] === '`') || text[end] === '`') plain(text.slice(0, end))
      else {
        plain(before)
        plain(m[1], ['code'])
      }
    } else if (m[2] !== undefined) {
      plain(before)
      plain(m[2])
    } else if (m[3] !== undefined) {
      // An image, or an address the editor would not link: stays as written.
      if ((m.index > 0 && text[m.index - 1] === '!') || !safeLink(m[4]!)) plain(text.slice(0, end))
      else {
        plain(before)
        spans.push(...spansOf(m[3], formats, m[4], m[5]))
      }
    } else if (m[6] !== undefined) {
      plain(before)
      spans.push(...spansOf(m[6], formats, m[6], title))
    } else if (m[7] !== undefined) {
      const address = bareAddress(m[7])
      end = m.index + address.length
      if (href !== undefined || address.length <= 'https://'.length) plain(text.slice(0, end))
      else {
        plain(before)
        spans.push({ text: address, formats, href: address })
      }
    } else if (m[8] !== undefined) {
      plain(before)
      inner(m[8], 'bold', 'italic')
    } else if (m[9] !== undefined) {
      plain(before)
      inner(m[9], 'bold')
    } else if (m[10] !== undefined) {
      plain(before)
      inner(m[10], 'strike')
    } else if (m[11] !== undefined) {
      plain(before)
      inner(m[11], 'highlight')
    } else if (m[12] !== undefined) {
      plain(before)
      inner(m[12], 'underline')
    } else if (m[13] !== undefined || m[15] !== undefined) {
      // An underscore inside a word (snake_case) is text.
      if (isWord(text[m.index - 1]) || isWord(text[end])) plain(text.slice(0, end))
      else {
        plain(before)
        inner((m[13] ?? m[15])!, m[13] !== undefined ? 'bold' : 'italic')
      }
    } else {
      plain(before)
      inner(m[14]!, 'italic')
    }
    text = text.slice(end)
  }
  return spans
}

/** Runs for a line of text, one per formatting, as the editor keeps them. The same reading as create_document. */
function inlineRuns(value: string, newID: () => string): JSONNode[] {
  const merged: Span[] = []
  for (const span of spansOf(value)) {
    const last = merged[merged.length - 1]
    if (last && last.href === span.href && last.title === span.title && last.formats.join() === span.formats.join()) last.text += span.text
    else merged.push({ ...span })
  }
  if (!merged.length) return [node('run', newID(), {}, [])]
  return merged.map((span) => {
    const attributes: Record<string, unknown> = {}
    const marks: Mark[] = span.formats.map((format) => ({ type: markOfFormat[format]! }))
    for (const format of span.formats) attributes[format] = true
    if (span.href) {
      attributes.href = span.href
      const link: Mark = { type: 'link', attrs: { href: span.href } }
      if (span.title) {
        attributes.linkTitle = span.title
        link.attrs!.title = span.title
      }
      marks.push(link)
    }
    return node('run', newID(), attributes, [{ type: 'text', text: span.text, ...(marks.length ? { marks } : {}) }])
  })
}

/** A node for a block of text; containers hold their blocks, and always at least one. */
function buildBlock(item: ParsedBlock, newID: () => string): JSONNode {
  const children = (blocks: ParsedBlock[]) => (blocks.length ? blocks.map((child) => buildBlock(child, newID)) : [buildBlock({ type: 'paragraph', text: '' }, newID)])
  switch (item.type) {
    // The editor keeps code as text directly in the block; most other blocks hold runs.
    case 'code_block':
      return node('code_block', newID(), { type: 'fenced', lang: item.lang }, textNode(item.text))
    case 'diagram':
      return node('diagram', newID(), { type: 'mermaid', lang: 'yaml' }, textNode(item.text))
    case 'thematic_break':
      return { type: 'thematic_break', attrs: { nodeID: newID(), bodyAttributes: '{}', bodyContent: '---' } }
    case 'atx_heading':
      return node('atx_heading', newID(), { level: item.level }, inlineRuns(item.text, newID))
    case 'paragraph':
      return node('paragraph', newID(), {}, inlineRuns(item.text, newID))
    case 'block_quote':
      return node('block_quote', newID(), {}, children(item.children))
    case 'notice':
      return node('notice', newID(), { variant: item.variant }, children(item.children))
    case 'list': {
      const itemType = item.kind === 'task' ? 'task_list_item' : 'list_item'
      const attributes = item.kind === 'order' ? { start: item.start, loose: false, delimiter: '.' } : { marker: '-', loose: false }
      const items = item.items.map((entry) => node(itemType, newID(), item.kind === 'task' ? { checked: entry.checked === true } : {}, children(entry.children)))
      return node(item.kind === 'order' ? 'order_list' : item.kind === 'task' ? 'task_list' : 'bullet_list', newID(), attributes, items)
    }
    case 'table': {
      const rows = item.rows.map((cells) =>
        node(
          'table_row',
          newID(),
          {},
          cells.map((cell, at) => node('table_cell', newID(), { align: item.aligns[at] ?? 'none' }, inlineRuns(cell, newID)))
        )
      )
      return node('table', newID(), {}, rows)
    }
  }
}

type NewBlock = ParsedBlock

/** New blocks; in suggest mode each is a proposed block insertion in the author's name. */
function newBlocks(items: NewBlock[], options: EditOptions, ids: string[]) {
  return items.map((item) => {
    const built = buildBlock(item, options.newID)
    if (options.mode === 'suggest') {
      const id = options.newID()
      ids.push(id)
      // The blocks inside a proposed container are proposed with it.
      const attributes = JSON.parse(String(built.attrs?.bodyAttributes)) as Record<string, unknown>
      attributes.suggestion = { kind: 'insert', id, author: options.author }
      built.attrs = { ...built.attrs, bodyAttributes: JSON.stringify(attributes) }
    }
    return built
  })
}

function headingLevel(block: JSONNode): number {
  try {
    const level = Number((JSON.parse(String(block.attrs?.bodyAttributes ?? '{}')) as { level?: unknown }).level)
    return Number.isFinite(level) && level >= 1 && level <= 6 ? level : 2
  } catch {
    return 2
  }
}

/** The text of a line without the Markdown mark read_document puts in front of it. */
const withoutMarkdownMarks = (value: string) => value.replace(/^\s*(?:#{1,6}[ \t]+|>[ \t]*|[-*+][ \t]+|\d+[.)][ \t]+)/, '')

/** A block only proposed by a suggestion is not part of the document yet: reading and matching skip it. */
function proposed(block: JSONNode): boolean {
  try {
    const suggestion = (JSON.parse(String(block.attrs?.bodyAttributes ?? '{}')) as { suggestion?: { kind?: string } }).suggestion
    return suggestion?.kind === 'insert'
  } catch {
    return false
  }
}

const squash = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase()

function replaceText(blocks: JSONNode[], operation: { find: string; replace: string }, options: EditOptions, ids: string[]) {
  if (!operation.find) throw new AgentEditError('replace_text needs the text to find, copied exactly from read_document')
  // A code block holds its text directly, not in runs, so it is searched as a whole.
  const matches: { run: JSONNode; index: number; section: string; codeAt?: number }[] = []
  let section = 'the start of the document'
  blocks.forEach((block, codeAt) => {
    if (proposed(block)) return
    if (headings.has(block.type)) section = `the section "${plain(block).trim()}"`
    if (block.type === 'code_block') {
      const codeText = canonical(block)
      for (let at = codeText.indexOf(operation.find); at !== -1; at = codeText.indexOf(operation.find, at + 1)) matches.push({ run: block, index: at, section, codeAt })
      return
    }
    walkRuns([block], (run) => {
      const runText = canonical(run)
      for (let at = runText.indexOf(operation.find); at !== -1; at = runText.indexOf(operation.find, at + 1))
        matches.push({ run, index: at, section })
    })
  })
  if (matches.length === 0) {
    const crossing = blocks.some((block) => canonical(block).includes(operation.find))
    const similar = blocks.find((block) => squash(canonical(block)).includes(squash(operation.find)))
    const unmarked = withoutMarkdownMarks(operation.find)
    const marked = unmarked !== operation.find && blocks.some((block) => canonical(block).includes(unmarked))
    if (marked)
      throw new AgentEditError(
        `"${operation.find}" starts with Markdown syntax (a list number, bullet, # or >) that read_document shows but the text does not hold; use "${unmarked}" without it`
      )
    throw new AgentEditError(
      crossing
        ? `"${operation.find}" spans differently formatted text; use a shorter piece that sits inside one formatting`
        : similar
          ? `"${operation.find}" was not found, but the same words exist with different spacing or capitals; copy the text exactly from read_document`
          : `"${operation.find}" was not found; the document may have changed, so read it again and copy the text exactly`
    )
  }
  if (matches.length > 1) {
    const where = [...new Set(matches.map((match) => match.section))].slice(0, 4).join(', ')
    throw new AgentEditError(`"${operation.find}" appears ${matches.length} times (in ${where}); include more surrounding text so it appears once`)
  }
  const { run, index, codeAt } = matches[0]!
  if (codeAt !== undefined) replaceInCode(blocks, codeAt, index, operation, options, ids)
  else run.content = spliceRun(run.content ?? [], index, operation.find.length, operation.replace, options, ids)
}

/**
 * Code takes no marks, so a suggested change to it is the old block proposed for deletion and
 * the changed one proposed right after it; a direct change rewrites the text.
 */
function replaceInCode(blocks: JSONNode[], at: number, index: number, operation: { find: string; replace: string }, options: EditOptions, ids: string[]) {
  const block = blocks[at]!
  const value = canonical(block)
  const next = value.slice(0, index) + operation.replace + value.slice(index + operation.find.length)
  if (options.mode === 'direct') {
    block.content = textNode(next)
    return
  }
  let attributes: { lang?: unknown; suggestion?: { kind?: string } } = {}
  try {
    attributes = JSON.parse(String(block.attrs?.bodyAttributes ?? '{}'))
  } catch {
    throw new AgentEditError('a block of the document has an unexpected shape')
  }
  if (attributes.suggestion?.kind === 'insert') throw new AgentEditError('this code block is itself a pending suggestion; accept or reject it before changing it')
  removeBlocks(blocks, at, at + 1, options, ids)
  blocks.splice(at + 1, 0, ...newBlocks([{ type: 'code_block', lang: String(attributes.lang ?? ''), text: next }], options, ids))
}

/**
 * Replaces `length` canonical characters at `start` in a run's text nodes. Direct mode
 * rewrites them; suggest mode marks them deleted and adds the new text as an insertion.
 */
function spliceRun(nodes: JSONNode[], start: number, length: number, replacement: string, options: EditOptions, ids: string[]): JSONNode[] {
  const suggestionID = options.mode === 'suggest' ? options.newID() : ''
  if (suggestionID) ids.push(suggestionID)
  const mark = (type: string): Mark => ({ type, attrs: { id: suggestionID, author: options.author } })
  const out: JSONNode[] = []
  let position = 0
  let inserted = false
  const insert = (marks: Mark[] | undefined) => {
    if (inserted || !replacement) return
    inserted = true
    const base = (marks ?? []).filter((m) => !m.type.startsWith('suggestion_'))
    const marksOut = options.mode === 'suggest' ? [...base, mark('suggestion_insert')] : base
    out.push({ type: 'text', text: replacement, ...(marksOut.length ? { marks: marksOut } : {}) })
  }
  const stop = start + length
  const piece = (text: string, marks?: Mark[]) => {
    if (text) out.push({ type: 'text', text, ...(marks?.length ? { marks } : {}) })
  }
  for (const child of nodes) {
    if (child.type !== 'text' || child.marks?.some((m) => m.type === 'suggestion_insert')) {
      out.push(child)
      continue
    }
    const value = child.text ?? ''
    const from = Math.max(start, position) - position
    const to = Math.min(stop, position + value.length) - position
    if (from < to) {
      piece(value.slice(0, from), child.marks)
      if (options.mode === 'suggest') piece(value.slice(from, to), [...(child.marks ?? []), mark('suggestion_delete')])
      if (to + position === stop) insert(child.marks)
      piece(value.slice(to), child.marks)
    } else out.push(child)
    position += value.length
  }
  insert(undefined)
  return out
}

function findHeading(blocks: JSONNode[], name: string): number {
  const wanted = name.trim().toLowerCase()
  const found = blocks.flatMap((block, index) => (headings.has(block.type) && !proposed(block) && plain(block).trim().toLowerCase() === wanted ? [index] : []))
  if (found.length === 0) throw new AgentEditError(`there is no heading "${name}"`)
  if (found.length > 1) throw new AgentEditError(`the heading "${name}" appears ${found.length} times`)
  return found[0]!
}

/** The blocks under a heading, up to the next heading of the same or a higher level. */
function sectionBody(blocks: JSONNode[], at: number): [number, number] {
  const level = headingLevel(blocks[at]!)
  let end = at + 1
  while (end < blocks.length && !(headings.has(blocks[end]!.type) && headingLevel(blocks[end]!) <= level)) end++
  return [at + 1, end]
}

/** Removes blocks; in suggest mode each stays, marked as a proposed deletion in the author's name. */
function removeBlocks(blocks: JSONNode[], from: number, to: number, options: EditOptions, ids: string[]) {
  if (options.mode === 'direct') {
    blocks.splice(from, to - from)
    return
  }
  for (const block of blocks.slice(from, to)) {
    let attributes: Record<string, unknown> = {}
    try {
      attributes = JSON.parse(String(block.attrs?.bodyAttributes ?? '{}')) as Record<string, unknown>
    } catch {
      throw new AgentEditError('a block of the document has an unexpected shape')
    }
    if ((attributes.suggestion as { kind?: string } | undefined)?.kind === 'insert') continue
    const id = options.newID()
    ids.push(id)
    attributes.suggestion = { kind: 'delete', id, author: options.author }
    block.attrs = { ...block.attrs, bodyAttributes: JSON.stringify(attributes) }
  }
}

/**
 * The block that holds `snippet`, so a range can start or end at it. A snippet of several lines
 * counts by its first line when it starts a range and by its last when it ends one, and spacing,
 * capitals and a leading list number or # mark do not matter. A start must be in one block; an
 * end is the first block at or after the start that holds it.
 */
function blockHolding(blocks: JSONNode[], snippet: string, role: string, after = 0): number {
  const lines = (snippet ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) throw new AgentEditError(`replace_range needs ${role}, a piece of text copied exactly from read_document`)
  const line = withoutMarkdownMarks(role === 'to' ? lines[lines.length - 1]! : lines[0]!).trim()
  // Any top-level block can bound a range: a list or a table counts by the text inside it.
  const holds = (block: JSONNode) => !proposed(block)
  const search = (matches: (text: string) => boolean) => blocks.flatMap((block, index) => (index >= after && holds(block) && matches(canonical(block)) ? [index] : []))
  let found = search((text) => text.includes(line))
  if (found.length === 0) found = search((text) => squash(text).includes(squash(line)))
  if (found.length === 0) {
    const where = role === 'to' ? ' at or after the block that holds from' : ''
    throw new AgentEditError(`${role} "${snippet}" was not found in one block${where}; copy a line from read_document and put one line in ${role}`)
  }
  if (found.length > 1 && role !== 'to') throw new AgentEditError(`${role} "${snippet}" appears in ${found.length} blocks; include more of the line so it appears once`)
  return found[0]!
}

/** The blocks from the one that holds `from` to the one that holds `to` (or `from` alone). */
function findRange(blocks: JSONNode[], from: string, to: string | undefined): [number, number] {
  const start = blockHolding(blocks, from, 'from')
  if (!to?.trim()) return [start, start]
  const end = blockHolding(blocks, to, 'to', start)
  if (end - start >= 400) throw new AgentEditError('replace_range covers more than 400 blocks; replace it in smaller ranges')
  return [start, end]
}

const textBlocksOf = (text: string | undefined, name: string) => {
  const blocks = blocksOf(text ?? '')
  if (blocks.length === 0) throw new AgentEditError(`${name} needs text`)
  return blocks
}

/** Applies the operations in order to a copy of the document. */
export function applyMarkdownOperations(json: unknown, operations: MarkdownOperation[], options: EditOptions) {
  if (!Array.isArray(operations) || operations.length === 0) throw new AgentEditError('there are no operations')
  if (operations.length > 50) throw new AgentEditError('at most 50 operations at a time; send the rest in another call')
  const copy = structuredClone(json) as JSONNode
  const blocks = body(copy)
  const suggestionIDs: string[] = []
  for (const operation of operations) {
    switch (operation?.type) {
      case 'replace_text':
        replaceText(blocks, operation, options, suggestionIDs)
        break
      case 'insert_after_heading': {
        const fresh = textBlocksOf(operation.text, 'insert_after_heading')
        const at = findHeading(blocks, operation.heading ?? '')
        blocks.splice(at + 1, 0, ...newBlocks(fresh, options, suggestionIDs))
        break
      }
      case 'append_section': {
        const title = (operation.heading ?? '').trim()
        if (!title) throw new AgentEditError('append_section needs a heading')
        const level = Math.min(6, Math.max(1, Math.trunc(Number(operation.level ?? 2)) || 2))
        blocks.push(
          ...newBlocks(
            [{ type: 'atx_heading', text: title, level }, ...blocksOf(operation.text ?? '')],
            options,
            suggestionIDs
          )
        )
        break
      }
      case 'append':
        blocks.push(...newBlocks(textBlocksOf(operation.text, 'append'), options, suggestionIDs))
        break
      case 'insert_before_heading': {
        const at = findHeading(blocks, operation.heading ?? '')
        blocks.splice(at, 0, ...newBlocks(textBlocksOf(operation.text, 'insert_before_heading'), options, suggestionIDs))
        break
      }
      case 'replace_section': {
        const fresh = textBlocksOf(operation.text, 'replace_section')
        const at = findHeading(blocks, operation.heading ?? '')
        const [from, to] = sectionBody(blocks, at)
        removeBlocks(blocks, from, to, options, suggestionIDs)
        // In suggest mode the old blocks stay, so the new ones go after them.
        const insertAt = options.mode === 'direct' ? from : to
        blocks.splice(insertAt, 0, ...newBlocks(fresh, options, suggestionIDs))
        break
      }
      case 'replace_range': {
        const fresh = richBlocksOf(operation.text ?? '')
        if (fresh.length === 0) throw new AgentEditError('replace_range needs text')
        const [from, to] = findRange(blocks, operation.from, operation.to)
        removeBlocks(blocks, from, to + 1, options, suggestionIDs)
        // In suggest mode the old blocks stay, so the new ones go after them.
        const insertAt = options.mode === 'direct' ? from : to + 1
        blocks.splice(insertAt, 0, ...newBlocks(fresh, options, suggestionIDs))
        break
      }
      case 'delete_section': {
        const at = findHeading(blocks, operation.heading ?? '')
        const [, to] = sectionBody(blocks, at)
        removeBlocks(blocks, at, to, options, suggestionIDs)
        break
      }
      default:
        throw new AgentEditError(
          `unknown operation ${JSON.stringify((operation as { type?: unknown })?.type)}; use replace_text, insert_after_heading, insert_before_heading, append_section, append, replace_section, replace_range or delete_section`
        )
    }
  }
  return { json: copy, suggestionIDs: [...new Set(suggestionIDs)] }
}

/** DBML and Mermaid have no suggest mode: these always rewrite the source. */
export function applySourceOperations(source: string, operations: SourceOperation[]): string {
  if (!Array.isArray(operations) || operations.length === 0) throw new AgentEditError('there are no operations')
  let text = source
  for (const operation of operations) {
    switch (operation?.type) {
      case 'replace_text': {
        if (!operation.find) throw new AgentEditError('replace_text needs the text to find')
        const count = text.split(operation.find).length - 1
        if (count === 0) throw new AgentEditError(`"${operation.find}" was not found; read the document again`)
        if (count > 1) throw new AgentEditError(`"${operation.find}" appears ${count} times; include more surrounding text`)
        text = text.replace(operation.find, () => operation.replace)
        break
      }
      case 'replace_all':
        text = operation.text ?? ''
        break
      case 'append':
        text += operation.text ?? ''
        break
      default:
        throw new AgentEditError(`unknown operation ${JSON.stringify((operation as { type?: unknown })?.type)}`)
    }
  }
  return text.replace(/\r\n?/g, '\n')
}

export const isTextBlock = (type: string) => textBlocks.has(type)
