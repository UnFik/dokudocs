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

/** Markdown text to a slice whose nodes carry no IDs; the editor assigns them. */
export async function markdownToSlice(markdown: string): Promise<Slice> {
  // Pasted text only has to read right, so it is imported leniently: a trailing
  // space or a line ending that does not survive an export must not refuse it.
  const parsed = await markdownToDocumentBody(
    crypto.randomUUID(),
    markdown.replace(/\r\n?/g, '\n'),
    1,
    { lenient: true }
  )
  const blocks = documentBodyToProseMirror(parsed.nodes).child(0).content
  const content = sanitizePastedSlice(new Slice(blocks, 0, 0)).content
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
