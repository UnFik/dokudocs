import { createHash } from 'node:crypto'

// The Agent's content edits (ADR 0043). They are targeted operations, applied to
// the document as the editor stores it, so they meet whoever is typing in the
// room like the edit of one more person. In suggest mode the result carries only
// suggestions in the author's name, and passes the same check as a person's.

export type MarkdownOperation =
  | { type: 'replace_text'; find: string; replace: string }
  | { type: 'insert_after_heading'; heading: string; text: string }
  | { type: 'append_section'; heading: string; level?: number; text: string }

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

function paragraphsOf(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\n/g, ' ').trim())
    .filter(Boolean)
}

/** New blocks; in suggest mode each is a proposed block insertion in the author's name. */
function newBlocks(items: { type: 'paragraph' | 'atx_heading'; text: string; level?: number }[], options: EditOptions, ids: string[]) {
  return items.map((item) => {
    const attributes: Record<string, unknown> = item.type === 'atx_heading' ? { level: item.level ?? 2 } : {}
    if (options.mode === 'suggest') {
      const id = options.newID()
      ids.push(id)
      attributes.suggestion = { kind: 'insert', id, author: options.author }
    }
    return node(item.type, options.newID(), attributes, [
      node('run', options.newID(), {}, item.text ? [{ type: 'text', text: item.text }] : []),
    ])
  })
}

function replaceText(blocks: JSONNode[], operation: { find: string; replace: string }, options: EditOptions, ids: string[]) {
  if (!operation.find) throw new AgentEditError('replace_text needs the text to find')
  const matches: { run: JSONNode; index: number }[] = []
  let crossing = 0
  walkRuns(blocks, (run) => {
    const runText = canonical(run)
    for (let at = runText.indexOf(operation.find); at !== -1; at = runText.indexOf(operation.find, at + 1))
      matches.push({ run, index: at })
  })
  if (matches.length === 0) {
    for (const block of blocks) if (canonical(block).includes(operation.find)) crossing++
    throw new AgentEditError(
      crossing
        ? `"${operation.find}" spans differently formatted text; find a shorter piece inside one formatting`
        : `"${operation.find}" was not found; read the document again`
    )
  }
  if (matches.length > 1) throw new AgentEditError(`"${operation.find}" appears ${matches.length} times; include more surrounding text`)
  const { run, index } = matches[0]!
  run.content = spliceRun(run.content ?? [], index, operation.find.length, operation.replace, options, ids)
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
  const found = blocks.flatMap((block, index) => (headings.has(block.type) && plain(block).trim().toLowerCase() === wanted ? [index] : []))
  if (found.length === 0) throw new AgentEditError(`there is no heading "${name}"`)
  if (found.length > 1) throw new AgentEditError(`the heading "${name}" appears ${found.length} times`)
  return found[0]!
}

/** Applies the operations in order to a copy of the document. */
export function applyMarkdownOperations(json: unknown, operations: MarkdownOperation[], options: EditOptions) {
  if (!Array.isArray(operations) || operations.length === 0) throw new AgentEditError('there are no operations')
  if (operations.length > 50) throw new AgentEditError('at most 50 operations at a time')
  const copy = structuredClone(json) as JSONNode
  const blocks = body(copy)
  const suggestionIDs: string[] = []
  for (const operation of operations) {
    switch (operation?.type) {
      case 'replace_text':
        replaceText(blocks, operation, options, suggestionIDs)
        break
      case 'insert_after_heading': {
        const paragraphs = paragraphsOf(operation.text ?? '')
        if (paragraphs.length === 0) throw new AgentEditError('insert_after_heading needs text')
        const at = findHeading(blocks, operation.heading ?? '')
        blocks.splice(at + 1, 0, ...newBlocks(paragraphs.map((text) => ({ type: 'paragraph' as const, text })), options, suggestionIDs))
        break
      }
      case 'append_section': {
        const title = (operation.heading ?? '').trim()
        if (!title) throw new AgentEditError('append_section needs a heading')
        const level = Math.min(6, Math.max(1, Math.trunc(Number(operation.level ?? 2)) || 2))
        blocks.push(
          ...newBlocks(
            [{ type: 'atx_heading', text: title, level }, ...paragraphsOf(operation.text ?? '').map((text) => ({ type: 'paragraph' as const, text }))],
            options,
            suggestionIDs
          )
        )
        break
      }
      default:
        throw new AgentEditError(`unknown operation ${JSON.stringify((operation as { type?: unknown })?.type)}`)
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
