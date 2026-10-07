import DOMPurify from 'dompurify'
import {
  Fragment,
  Slice,
  type Node as ProseMirrorNode,
} from 'prosemirror-model'
import { Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { documentBodyToMarkdown } from '../../muya/state/documentBodyToMarkdown'
import HtmlToMarkdown from '../../muya/state/htmlToMarkdown'
import { markdownToDocumentBody } from '../../muya/state/markdownToDocumentBody'
import {
  documentBodySchema,
  documentBodyToProseMirror,
  prosemirrorToDocumentBody,
} from '../documentBody'

const inlineTypes = new Set([
  'text',
  'run',
  'image',
  'math',
  'line_break',
  'opaque_inline',
])

const blockStart = /^\s*([-*+]\s|\d+[.)]\s|#{1,6}\s|>|\||```|---+\s*$)/

/**
 * Pasted Markdown with its line endings made plain and the spaces that end a
 * block removed. Two spaces at the end of a list item or a paragraph are how
 * some tools write "and then a line break", but nothing follows them; they would
 * become two spaces of text. Inside a paragraph, where another line of it
 * follows, they stay: that is a real line break.
 */
export function normalizePastedMarkdown(text: string): string {
  const lines = joinSpacedTableRows(text.replace(/\r\n?/g, '\n').split('\n'))
  return lines
    .map((line, index) => {
      if (!/ {2,}$/.test(line)) return line.replace(/\t+$/, '')
      const next = lines[index + 1]
      const endsBlock =
        next === undefined || next.trim() === '' || blockStart.test(next)
      return endsBlock ? line.replace(/[ \t]+$/, '') : line
    })
    .join('\n')
}

const tableDelimiterRow = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/**
 * A table copied from a page that puts each row in its own paragraph arrives
 * with a blank line between rows, which reads as many one-line paragraphs. A run
 * of pipe rows with one blank line between each, whose second row is the
 * delimiter row, is joined back into one table.
 */
function joinSpacedTableRows(lines: string[]): string[] {
  const out: string[] = []
  let index = 0
  while (index < lines.length) {
    const rows: string[] = []
    let end = index
    while (
      end < lines.length &&
      lines[end]!.trim().startsWith('|') &&
      (end + 1 >= lines.length || lines[end + 1]!.trim() === '') &&
      (end + 2 >= lines.length || lines[end + 2]!.trim().startsWith('|'))
    ) {
      rows.push(lines[end]!)
      end += 2
    }
    const last = end < lines.length && lines[end]!.trim().startsWith('|')
    if (last) rows.push(lines[end]!)
    if (rows.length >= 3 && tableDelimiterRow.test(rows[1]!)) {
      out.push(...rows)
      index = end + (last ? 1 : 0)
    } else {
      out.push(lines[index]!)
      index++
    }
  }
  return out
}

type Segment =
  | { kind: 'markdown'; text: string }
  | { kind: 'notice'; variant: string; text: string }
  | { kind: 'toggle'; text: string }

const noticeVariants = new Set(['info', 'success', 'warning', 'tip'])

/** Splits `:::variant` and `+++` blocks out of the Markdown, leaving code fences alone. */
function splitContainers(markdown: string): Segment[] {
  const segments: Segment[] = []
  let plain: string[] = []
  let open: {
    kind: 'notice' | 'toggle'
    variant: string
    lines: string[]
  } | null = null
  let fenced = false
  const flush = () => {
    if (plain.join('\n').trim())
      segments.push({ kind: 'markdown', text: plain.join('\n') })
    plain = []
  }
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    if (!fenced) {
      if (open) {
        const closes =
          open.kind === 'notice'
            ? /^:::\s*$/.test(line)
            : /^\+\+\+\s*$/.test(line)
        if (closes) {
          const text = open.lines.join('\n')
          segments.push(
            open.kind === 'notice'
              ? { kind: 'notice', variant: open.variant, text }
              : { kind: 'toggle', text }
          )
          open = null
        } else open.lines.push(line)
        continue
      }
      const notice = /^:::(\w+)\s*$/.exec(line)
      if (notice && noticeVariants.has(notice[1]!)) {
        flush()
        open = { kind: 'notice', variant: notice[1]!, lines: [] }
        continue
      }
      if (/^\+\+\+\s*$/.test(line)) {
        flush()
        open = { kind: 'toggle', variant: '', lines: [] }
        continue
      }
    }
    plain.push(line)
  }
  // A marker that never closes is just text.
  if (open) {
    plain.push(
      open.kind === 'notice' ? `:::${open.variant}` : '+++',
      ...open.lines
    )
  }
  flush()
  return segments
}

async function parseBlocks(markdown: string): Promise<ProseMirrorNode[]> {
  const parsed = await markdownToDocumentBody(
    crypto.randomUUID(),
    normalizePastedMarkdown(markdown),
    1,
    { lenient: true }
  )
  const blocks: ProseMirrorNode[] = []
  documentBodyToProseMirror(parsed.nodes)
    .child(0)
    .content.forEach((node) => blocks.push(node))
  return blocks
}

const emptyParagraph = () =>
  documentBodySchema.nodes.paragraph!.create({
    nodeID: null,
    bodyAttributes: '{}',
    bodyContent: '',
  })

/** Markdown text to a slice whose nodes carry no IDs; the editor assigns them. */
export async function markdownToSlice(markdown: string): Promise<Slice> {
  // Pasted text only has to read right, so it is imported leniently: a trailing
  // space or a line ending that does not survive an export must not refuse it.
  const segments = splitContainers(markdown.replace(/\r\n?/g, '\n'))
  const blocks: ProseMirrorNode[] = []
  for (const segment of segments) {
    if (segment.kind === 'markdown') {
      blocks.push(...(await parseBlocks(segment.text)))
      continue
    }
    const inner = await parseBlocks(segment.text)
    const content = inner.length ? inner : [emptyParagraph()]
    blocks.push(
      documentBodySchema.nodes[segment.kind]!.create(
        {
          nodeID: null,
          bodyAttributes: JSON.stringify(
            segment.kind === 'notice' ? { variant: segment.variant } : {}
          ),
          bodyContent: '',
        },
        content
      )
    )
  }
  const content = sanitizePastedSlice(
    new Slice(Fragment.from(blocks.length ? blocks : [emptyParagraph()]), 0, 0)
  ).content
  if (
    content.childCount === 1 &&
    content.child(0).type === documentBodySchema.nodes.paragraph
  )
    return new Slice(content, 1, 1)
  return new Slice(content, 0, 0)
}

/**
 * Pasted nodes must never reuse an existing node ID, and opaque nodes are
 * only ever created by the importer, so both are removed here.
 */
export function sanitizePastedSlice(slice: Slice): Slice {
  const clean = (
    node: ProseMirrorNode
  ): ProseMirrorNode | ProseMirrorNode[] => {
    if (node.isText) return node
    if (node.type.name === 'opaque_inline') {
      const text = String(node.attrs.bodyContent ?? '')
      return text ? documentBodySchema.text(text) : []
    }
    if (node.type.name === 'opaque') {
      const text = String(node.attrs.bodyContent ?? '')
      return documentBodySchema.nodes.paragraph!.create(
        { nodeID: null, bodyAttributes: '{}', bodyContent: '' },
        text ? [documentBodySchema.text(text)] : []
      )
    }
    const children: ProseMirrorNode[] = []
    node.forEach((child) => children.push(...[clean(child)].flat()))
    return node.type.create(
      { ...node.attrs, nodeID: null },
      children,
      node.marks
    )
  }
  const content: ProseMirrorNode[] = []
  slice.content.forEach((node) => content.push(...[clean(node)].flat()))
  return new Slice(Fragment.from(content), slice.openStart, slice.openEnd)
}

export function htmlToMarkdownText(html: string): string {
  const safe = DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'script', 'meta', 'link', 'iframe', 'object'],
    FORBID_ATTR: ['style', 'class', 'id'],
  })
  return new HtmlToMarkdown().generate(safe).trim()
}

const markdownSignals = [
  /^#{1,6}\s+\S/m,
  /^\s*[-*+]\s+\S/m,
  /^\s*\d+[.)]\s+\S/m,
  /^>\s?\S/m,
  /^```/m,
  /^\|.+\|\s*$/m,
  /^\s*---+\s*$/m,
  /^:::(info|success|warning|tip)\s*$/m,
  /^\+\+\+\s*$/m,
  /\*\*[^*\n]+\*\*/,
  /(^|[^\w])_[^_\n]+_([^\w]|$)/,
  /`[^`\n]+`/,
  /!?\[[^\]\n]*\]\([^)\n]+\)/,
  /~~[^~\n]+~~/,
]

export function looksLikeMarkdown(text: string) {
  return markdownSignals.some((signal) => signal.test(text))
}

type Source = { kind: 'markdown' | 'html'; text: string }

/** Decides synchronously whether this paste should be converted. */
export function clipboardSource(data: DataTransfer | null): Source | null {
  if (!data) return null
  const html = data.getData('text/html')
  if (html.includes('data-pm-slice')) return null
  const isCodeEditor = data.types.includes('vscode-editor-data')
  if (html.trim() && !isCodeEditor) return { kind: 'html', text: html }
  const text = data.getData('text/plain')
  if (text.trim() && looksLikeMarkdown(text)) return { kind: 'markdown', text }
  return null
}

export async function pasteFromClipboard(
  view: EditorView,
  data: DataTransfer | null
): Promise<boolean> {
  const source = clipboardSource(data)
  if (!source || !view.editable) return false
  const markdown =
    source.kind === 'html' ? htmlToMarkdownText(source.text) : source.text
  if (!markdown.trim()) return false
  // Pasting must never do nothing. If the converted blocks cannot be placed
  // where the caret is, or the text cannot be converted at all, it goes in as
  // plain paragraphs.
  const before = view.state.doc
  try {
    const slice = await markdownToSlice(markdown)
    if (view.isDestroyed) return true
    view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView())
    if (view.state.doc !== before) return true
  } catch {
    if (view.isDestroyed) return true
  }
  view.dispatch(
    view.state.tr.replaceSelection(plainTextSlice(markdown)).scrollIntoView()
  )
  return true
}

/** The text as paragraphs, one per line, with no formatting. */
export function plainTextSlice(text: string): Slice {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const paragraphs = lines.map((line) =>
    documentBodySchema.nodes.paragraph!.create(
      { nodeID: null, bodyAttributes: '{}', bodyContent: '' },
      line ? [documentBodySchema.text(line)] : []
    )
  )
  return paragraphs.length === 1
    ? new Slice(Fragment.from(paragraphs), 1, 1)
    : new Slice(Fragment.from(paragraphs), 0, 0)
}

function wrapInlineRuns(nodes: ProseMirrorNode[]) {
  const wrapped: ProseMirrorNode[] = []
  let count = 0
  for (let i = 0; i < nodes.length; ) {
    const node = nodes[i]!
    if (!node.isText) {
      wrapped.push(node)
      i++
      continue
    }
    const group = [node]
    i++
    while (
      i < nodes.length &&
      nodes[i]!.isText &&
      nodes[i]!.marks.length === node.marks.length &&
      nodes[i]!.marks.every((mark, index) => mark.eq(node.marks[index]!))
    )
      group.push(nodes[i++]!)
    wrapped.push(
      documentBodySchema.nodes.run!.create(
        {
          nodeID: `clipboard-run-${count++}`,
          bodyAttributes: '{}',
          bodyContent: '',
        },
        group
      )
    )
  }
  return wrapped
}

/** Copy as Markdown; anything that cannot be mapped to the AST becomes plain text. */
export function sliceToMarkdown(slice: Slice): string {
  const plain = () => slice.content.textBetween(0, slice.content.size, '\n\n')
  try {
    const children: ProseMirrorNode[] = []
    slice.content.forEach((node) => children.push(node))
    const inline =
      children.length > 0 && children.every((n) => inlineTypes.has(n.type.name))
    const blocks = inline
      ? [
          documentBodySchema.nodes.paragraph!.create(
            {
              nodeID: 'clipboard-paragraph',
              bodyAttributes: '{}',
              bodyContent: '',
            },
            wrapInlineRuns(children)
          ),
        ]
      : children
    const root = documentBodySchema.nodes.document!.create(
      { nodeID: 'clipboard-root', bodyAttributes: '{}', bodyContent: '' },
      blocks
    )
    const body = prosemirrorToDocumentBody(
      documentBodySchema.topNodeType.create(null, root)
    )
    return documentBodyToMarkdown(body).trim()
  } catch {
    return plain()
  }
}

export function clipboardPlugin() {
  return new Plugin({
    props: {
      transformPasted: sanitizePastedSlice,
      clipboardTextSerializer: (slice) => sliceToMarkdown(slice),
      handlePaste(view, event) {
        if (!clipboardSource(event.clipboardData)) return false
        void pasteFromClipboard(view, event.clipboardData)
        return true
      },
    },
  })
}
