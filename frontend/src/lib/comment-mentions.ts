// A comment names a person with a token, @[Name](user:<id>). The backend reads
// the same grammar (internal/domain/mention); both are held to
// fixtures/comment-mentions.json. In a text box the token would be 45
// characters of noise, so there a mention reads as @Name and is tracked by
// position until it is serialized back.

// The label excludes control characters on purpose, as the backend grammar does.
const TOKEN =
  // eslint-disable-next-line no-control-regex
  /@\[([^[\]()\u0000-\u001f\u007f]{1,100})\]\(user:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g

/** The longest name fragment that still counts as typing a mention. */
const MAX_QUERY = 50

export type Mention = { userID: string; label: string }

/** A mention in the text of a box: text.slice(start, end) is "@" + label. */
export type PlacedMention = Mention & { start: number; end: number }

export function mentionToken(userID: string, label: string): string {
  return `@[${label}](user:${userID})`
}

export function parseMentions(content: string): Mention[] {
  return Array.from(content.matchAll(TOKEN), (match) => ({
    userID: match[2].toLowerCase(),
    label: match[1],
  }))
}

/** The comment as it reads: each token shows as @Name. */
export function visibleText(content: string): string {
  return content.replace(TOKEN, '@$1')
}

/** Splits a comment into the text and the mentions, in order, to render. */
export function commentParts(
  content: string
): ({ kind: 'text'; text: string } | ({ kind: 'mention' } & Mention))[] {
  const parts: ReturnType<typeof commentParts> = []
  let at = 0
  for (const match of content.matchAll(TOKEN)) {
    if (match.index > at) {
      parts.push({ kind: 'text', text: content.slice(at, match.index) })
    }
    parts.push({
      kind: 'mention',
      userID: match[2].toLowerCase(),
      label: match[1],
    })
    at = match.index + match[0].length
  }
  if (at < content.length) parts.push({ kind: 'text', text: content.slice(at) })
  return parts
}

/** Turns a stored comment into the text of a box and where its mentions are. */
export function deserialize(content: string): {
  text: string
  mentions: PlacedMention[]
} {
  let text = ''
  let at = 0
  const mentions: PlacedMention[] = []
  for (const match of content.matchAll(TOKEN)) {
    text += content.slice(at, match.index)
    const start = text.length
    text += `@${match[1]}`
    mentions.push({
      start,
      end: text.length,
      userID: match[2].toLowerCase(),
      label: match[1],
    })
    at = match.index + match[0].length
  }
  return { text: text + content.slice(at), mentions }
}

/** The stored comment for the text of a box; a mention whose text was changed is left as text. */
export function serialize(text: string, mentions: PlacedMention[]): string {
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
    content += mentionToken(mention.userID, mention.label)
    at = mention.end
  }
  return content + text.slice(at)
}

/** Carries mentions across an edit: they move with the text, and one the edit touched becomes plain text. */
export function trackEdit(
  mentions: PlacedMention[],
  before: string,
  after: string
): PlacedMention[] {
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
 * The name being typed after an @ just before the caret, or null. The @ has to
 * open a word, so an email address does not open the list, and the name may
 * hold spaces so it can narrow to a full name. An @ that already is a mention
 * opens nothing.
 */
export function activeMentionQuery(
  text: string,
  caret: number,
  mentions: PlacedMention[] = []
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
