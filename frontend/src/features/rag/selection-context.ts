import {
  MAX_ATTACHMENT_CHARS,
  MAX_FILES,
  type Attachment,
} from './question-extras'

const SNIPPET_CHARS = 40

/** The words of a markdown line as a reader sees them: no markers, no emphasis. */
function plain(line: string) {
  return line
    .replace(/^(\s*(#{1,6}|>|[-*+]|\d+\.|- \[[ xX]\])\s+)+/, '')
    .replace(/[*_`~]/g, '')
    .trim()
}

function snippet(text: string) {
  const words = text.replace(/\s+/g, ' ').trim()
  return words.length > SNIPPET_CHARS
    ? `${words.slice(0, SNIPPET_CHARS).trimEnd()}…`
    : words
}

/** The 1-based line holding `part`, or nothing when no line or several do. */
function lineOf(lines: string[], part: string, from = 0) {
  const hits: number[] = []
  for (let i = from; i < lines.length; i++)
    if (lines[i].includes(part)) hits.push(i + 1)
  return hits.length === 1 ? hits[0] : undefined
}

/**
 * What a selection becomes when it is added to a question: its text, named by
 * its first words and, when the page's markdown shows where it sits, its lines.
 */
export function selectionAttachment(
  markdown: string,
  selected: string
): Attachment {
  const lines = markdown.split('\n').map(plain)
  const parts = selected
    .split('\n')
    .map(plain)
    .filter((part) => part !== '')
  const first = parts.length ? lineOf(lines, parts[0]) : undefined
  const last =
    first === undefined
      ? undefined
      : parts.length > 1
        ? lineOf(lines, parts[parts.length - 1], first)
        : first
  const where =
    first === undefined || last === undefined
      ? ''
      : first === last
        ? ` · L${first}`
        : ` · L${first}–${last}`
  return { name: `${snippet(selected)}${where}`, text: selected }
}

/**
 * Puts a selection with the attachments already on the question. The same text
 * twice changes nothing; at the limits the question keeps what it had and the
 * reason comes back.
 */
export function addSelection(
  existing: Attachment[],
  added: Attachment
): { attachments: Attachment[]; error?: string } {
  if (existing.some((have) => have.text === added.text))
    return { attachments: existing }
  if (existing.length >= MAX_FILES)
    return {
      attachments: existing,
      error: `Attach up to ${MAX_FILES} files to one question.`,
    }
  const total =
    existing.reduce((sum, have) => sum + have.text.length, 0) +
    added.text.length
  if (total > MAX_ATTACHMENT_CHARS)
    return {
      attachments: existing,
      error: `That selection is too long. All the files together may hold up to ${MAX_ATTACHMENT_CHARS.toLocaleString('en-US')} characters.`,
    }
  let name = added.name
  for (let n = 2; existing.some((have) => have.name === name); n++)
    name = `${added.name} (${n})`
  return { attachments: [...existing, { ...added, name }] }
}
