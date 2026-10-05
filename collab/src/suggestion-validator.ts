// What a person who may only suggest is allowed to write (ADR 0027). Their
// change is checked as a before and an after document: the canonical text must
// stay as it was, and the only things that may differ are suggestion marks that
// carry their own name.

type Mark = { type: string; attrs?: Record<string, unknown> }
type JSONNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: JSONNode[]
  text?: string
  marks?: Mark[]
}

export type Verdict = { ok: true } | { ok: false; reason: string }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const markKinds = new Set(['suggestion_insert', 'suggestion_delete', 'suggestion_format'])
const formatKeys: Record<string, 'boolean' | 'string'> = {
  bold: 'boolean',
  italic: 'boolean',
  strike: 'boolean',
  code: 'boolean',
  href: 'string',
  linkTitle: 'string',
}

type Found = { key: string; author: string; text: string }

function isText(value: unknown): value is [string, unknown[]] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string'
}

function nodeSuggestion(node: JSONNode): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(String(node.attrs?.bodyAttributes ?? '{}')) as Record<string, unknown>
    const value = parsed.suggestion
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function checkIdentity(object: Record<string, unknown>): string | null {
  if (typeof object.id !== 'string' || !uuid.test(object.id)) return 'a suggestion id must be a UUID'
  if (typeof object.author !== 'string' || !uuid.test(object.author)) return 'a suggestion author must be a UUID'
  return null
}

function checkMark(mark: Mark): string | null {
  const attrs = mark.attrs ?? {}
  const allowed = new Set(['id', 'author'])
  if (mark.type === 'suggestion_format') allowed.add('set')
  for (const key of Object.keys(attrs)) if (!allowed.has(key)) return `${mark.type} has unsupported key ${key}`
  const identity = checkIdentity(attrs)
  if (identity) return identity
  if (mark.type === 'suggestion_format') {
    const set = attrs.set
    if (!set || typeof set !== 'object' || Object.keys(set).length === 0) return 'a format suggestion needs what it proposes'
    for (const [key, value] of Object.entries(set as Record<string, unknown>))
      if (!formatKeys[key] || typeof value !== formatKeys[key]) return `format suggestion key ${key} is not allowed`
  }
  return null
}

function checkNodeSuggestion(object: Record<string, unknown>): string | null {
  const allowed = new Set(['kind', 'id', 'author', 'toType', 'toAttributes'])
  for (const key of Object.keys(object)) if (!allowed.has(key)) return `suggestion has unsupported key ${key}`
  if (object.kind !== 'insert' && object.kind !== 'delete' && object.kind !== 'format')
    return 'suggestion kind must be insert, delete, or format'
  const identity = checkIdentity(object)
  if (identity) return identity
  const proposes = 'toType' in object || 'toAttributes' in object
  if (proposes && object.kind !== 'format') return 'only a format suggestion proposes a type or attributes'
  if (object.kind === 'format' && !proposes) return 'a format suggestion needs what it proposes'
  return null
}

/** The canonical shape of a document (what is left once suggestions are set aside) and every suggestion in it. */
function inspect(root: JSONNode): { canonical: string; found: Found[]; problem: string | null } {
  const found: Found[] = []
  let problem: string | null = null
  const visit = (node: JSONNode): unknown => {
    if (node.type === 'text') {
      const marks = node.marks ?? []
      let proposedInsert = false
      for (const mark of marks) {
        if (!markKinds.has(mark.type)) continue
        problem ??= checkMark(mark)
        const attrs = mark.attrs ?? {}
        found.push({ key: `${mark.type}:${String(attrs.id)}:${JSON.stringify(attrs.set ?? null)}`, author: String(attrs.author), text: node.text ?? '' })
        if (mark.type === 'suggestion_insert') proposedInsert = true
      }
      if (proposedInsert) return null
      return [node.text, marks.filter((mark) => !markKinds.has(mark.type))]
    }
    const suggestion = nodeSuggestion(node)
    if (suggestion) {
      problem ??= checkNodeSuggestion(suggestion)
      found.push({ key: `node:${JSON.stringify(suggestion)}`, author: String(suggestion.author), text: String(node.attrs?.nodeID) })
      if (suggestion.kind === 'insert') return null
    }
    // A node suggestion lives in bodyAttributes; without it the node reads as it was.
    let attributes = String(node.attrs?.bodyAttributes ?? '{}')
    if (suggestion) {
      const parsed = JSON.parse(attributes) as Record<string, unknown>
      delete parsed.suggestion
      attributes = JSON.stringify(parsed)
    }
    const children: unknown[] = []
    for (const child of (node.content ?? []).map(visit)) {
      if (child === null) continue
      // Text split by a suggestion mark is the same text once the marks are set aside.
      const last = children.at(-1)
      if (isText(child) && isText(last) && JSON.stringify(last[1]) === JSON.stringify(child[1])) last[0] += child[0]
      else children.push(child)
    }
    return [node.type, node.attrs?.nodeID, attributes, node.attrs?.bodyContent, children]
  }
  return { canonical: JSON.stringify(visit(root)), found, problem }
}

/**
 * Checks one change made by someone who may only suggest. `before` and `after`
 * are the document as ProseMirror JSON.
 */
export function validateSuggesterChange(before: unknown, after: unknown, userID: string): Verdict {
  const was = inspect(before as JSONNode)
  const now = inspect(after as JSONNode)
  if (now.problem) return { ok: false, reason: now.problem }
  if (was.canonical !== now.canonical) return { ok: false, reason: 'You can only suggest changes here.' }
  const signature = (item: Found) => `${item.key}|${item.author}|${item.text}`
  const had = new Set(was.found.map(signature))
  const has = new Set(now.found.map(signature))
  for (const item of now.found)
    if (!had.has(signature(item)) && item.author !== userID)
      return { ok: false, reason: 'A suggestion must carry the name of the person who made it.' }
  for (const item of was.found)
    if (item.author !== userID && !has.has(signature(item)))
      return { ok: false, reason: 'You cannot change someone else’s suggestion.' }
  return { ok: true }
}
