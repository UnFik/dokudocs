// A question names a document with a token, @[Title](doc:<id>), the way a
// comment names a person (ADR 0036). The backend reads the same grammar
// (internal/domain/mention); both are held to document-mentions.fixture.json.
// In the text box the token reads as @Title and is tracked by position until
// the question is sent.

// The label excludes control characters on purpose, as the backend grammar does.
const TOKEN =
  // eslint-disable-next-line no-control-regex
  /@\[([^[\]()\u0000-\u001f\u007f]{1,100})\]\(doc:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g

/** The longest title fragment that still counts as typing a mention. */
const MAX_QUERY = 60

/** How many different documents one question may name; the backend enforces it. */
export const MAX_DOCUMENT_MENTIONS = 5

export type DocumentMention = { documentID: string; label: string }

/** A mention in the text of a box: text.slice(start, end) is "@" + label. */
export type PlacedDocumentMention = DocumentMention & {
  start: number
  end: number
}

/** A title as a token label: no brackets, parentheses, "@" or control characters. */
export function documentLabel(title: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = title
    .replace(/[[\]()@]/g, '')
    .replace(/[\u0000-\u001f\u007f\s]+/g, ' ')
  const label = Array.from(cleaned.trim()).slice(0, 100).join('').trim()
  return label || 'Untitled'
}

export function documentToken(documentID: string, label: string): string {
  return `@[${label}](doc:${documentID})`
}

export function parseDocumentMentions(content: string): DocumentMention[] {
  return Array.from(content.matchAll(TOKEN), (match) => ({
    documentID: match[2].toLowerCase(),
    label: match[1],
  }))
}

/** The question as it reads: each token shows as @Title. */
export function visibleText(content: string): string {
  return content.replace(TOKEN, '@$1')
}

export type MessagePart =
  | { kind: 'text'; text: string }
  | ({ kind: 'document' } & DocumentMention)

/** Splits a question into the text and the documents it names, in order, to render. */
export function messageParts(content: string): MessagePart[] {
  const parts: MessagePart[] = []
  let at = 0
  for (const match of content.matchAll(TOKEN)) {
    if (match.index > at) {
      parts.push({ kind: 'text', text: content.slice(at, match.index) })
    }
    parts.push({
      kind: 'document',
      documentID: match[2].toLowerCase(),
      label: match[1],
    })
    at = match.index + match[0].length
  }
  if (at < content.length) parts.push({ kind: 'text', text: content.slice(at) })
  return parts
}

/** Turns a stored question into the text of a box and where its mentions are. */
export function deserialize(content: string): {
  text: string
  mentions: PlacedDocumentMention[]
} {
  let text = ''
  let at = 0
  const mentions: PlacedDocumentMention[] = []
  for (const match of content.matchAll(TOKEN)) {
    text += content.slice(at, match.index)
    const start = text.length
    text += `@${match[1]}`
    mentions.push({
      start,
      end: text.length,
      documentID: match[2].toLowerCase(),
      label: match[1],
    })
    at = match.index + match[0].length
  }
  return { text: text + content.slice(at), mentions }
}

/** The stored question for the text of a box; a mention whose text was changed is left as text. */
export function serialize(
  text: string,
  mentions: PlacedDocumentMention[]
): string {
  let content = ''
  let at = 0
  for (const mention of [...mentions].sort((a, b) => a.start - b.start)) {
    if (
      mention.start < at ||
      text.slice(mention.start, mention.end) !== `@${mention.label}`
    ) {
      continue
    }
    content += text.slice(at, mention.start)
    content += documentToken(mention.documentID, mention.label)
    at = mention.end
  }
  return content + text.slice(at)
}

/** Carries mentions across an edit: they move with the text, and one the edit touched becomes plain text. */
export function trackEdit(
  mentions: PlacedDocumentMention[],
  before: string,
  after: string
): PlacedDocumentMention[] {
  if (before === after) return mentions
  const room = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < room && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (
    suffix < room - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++
  }
  const editEnd = before.length - suffix
  const delta = after.length - before.length
  return mentions.flatMap((mention) => {
    if (mention.end <= prefix) return [mention]
    if (mention.start >= editEnd) {
      return [
        { ...mention, start: mention.start + delta, end: mention.end + delta },
      ]
    }
    return []
  })
}

/**
 * The title being typed after an @ just before the caret, or null. The @ has to
 * open a word, so an email address does not open the list, and the title may
 * hold spaces so it can narrow to a full title. An @ that already is a mention
 * opens nothing.
 */
export function activeMentionQuery(
  text: string,
  caret: number,
  mentions: PlacedDocumentMention[] = []
): { start: number; query: string } | null {
  for (let at = caret - 1; at >= 0; at--) {
    const char = text[at]
    if (char === '\n') return null
    if (char !== '@') continue
    if (at > 0 && !/\s/.test(text[at - 1])) return null
    if (mentions.some((mention) => mention.start === at)) return null
    const query = text.slice(at + 1, caret)
    if (query.length > MAX_QUERY || /^\s|[[\]()]/.test(query)) return null
    return { start: at, query }
  }
  return null
}
