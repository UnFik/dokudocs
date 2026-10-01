import { writeFileSync } from 'node:fs'
import { prosemirrorToYDoc } from 'y-prosemirror'
import * as Y from 'yjs'
import { documentBodyToProseMirror } from '../src/features/docs/lib/prosemirror/documentBody.ts'

const ids = new Map<string, string>()
const nodes: { nodeID: string; parentID: string | null; siblingOrder: number; type: string; content: string; attributes: Record<string, unknown> }[] = []
const add = (parentKey: string | null, type: string, content = '', attributes: Record<string, unknown> = {}) => {
  const nodeID = `00000000-0000-4000-8000-${String(nodes.length + 1).padStart(12, '0')}`
  const parentID = parentKey === null ? null : ids.get(parentKey)!
  const siblingOrder = nodes.filter(node => node.parentID === parentID).length
  const key = `n${nodes.length}`
  ids.set(key, nodeID)
  nodes.push({ nodeID, parentID, siblingOrder, type, content, attributes })
  return key
}
const root = add(null, 'document')
const paragraph = add(root, 'paragraph')
add(paragraph, 'run', 'bold', { bold: true, boldMarker: '**', source: '**bold**' })
add(paragraph, 'image', '', { src: 'https://example.com/a.png', alt: 'a' })
add(paragraph, 'math', 'x + y', { marker: '$' })
add(paragraph, 'line-break', '', { hard: true })
add(paragraph, 'opaque-inline', '\\literal{raw}')
add(paragraph, 'run', ' linked', { href: 'https://example.com', linkTitle: 'example' })
add(root, 'paragraph', 'legacy parent text')
const atx = add(root, 'atx-heading', '', { level: 2 })
add(atx, 'run', 'Heading')
const setext = add(root, 'setext-heading', '', { level: 1, underline: '=' })
add(setext, 'run', 'Setext')
add(root, 'thematic-break', '---')
add(root, 'code-block', 'const value = 1', { type: 'fenced', lang: 'ts', fenceLength: 3 })
add(root, 'html-block', '<!-- exact source -->')
add(root, 'link-reference-definition', '[ref]: https://example.com')
const quote = add(root, 'block-quote')
const qp = add(quote, 'paragraph')
add(qp, 'run', 'quoted')
const ordered = add(root, 'order-list', '', { start: 2, loose: false, delimiter: ')' })
const oi = add(ordered, 'list-item')
const op = add(oi, 'paragraph')
add(op, 'run', 'ordered')
const bullet = add(root, 'bullet-list', '', { marker: '*', loose: true })
const bi = add(bullet, 'list-item')
const bp = add(bi, 'paragraph')
add(bp, 'run', 'bullet')
const task = add(root, 'task-list', '', { marker: '-', loose: false })
const ti = add(task, 'task-list-item', '', { checked: true })
const tp = add(ti, 'paragraph')
add(tp, 'run', 'task')
const table = add(root, 'table')
const row = add(table, 'table.row')
const cell = add(row, 'table.cell', '', { align: 'center' })
add(cell, 'run', 'cell')
add(root, 'math-block', 'x = 1', { mathStyle: '' })
add(root, 'frontmatter', 'title: doc', { lang: 'yaml', style: '-' })
add(root, 'diagram', 'graph: {}', { type: 'mermaid', lang: 'yaml' })
const footnote = add(root, 'footnote', '', { identifier: 'note-1' })
const fp = add(footnote, 'paragraph')
add(fp, 'run', 'note')
add(root, 'opaque', '::: unsupported syntax\nexact bytes')
const doc = prosemirrorToYDoc(documentBodyToProseMirror(nodes), 'body')
writeFileSync('/tmp/dokudocs-full-body-yjs-v1.b64', Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64') + '\n')
doc.destroy()
