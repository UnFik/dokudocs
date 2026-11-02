const NOTE_TOKEN_RE = /__DBML_NOTE_(\d+)__/

export interface MaskedDbml {
  text: string
  notes: string[]
}

interface ReadString {
  value: string
  end: number
}

const ESCAPES: Record<string, string> = { n: '\n', "'": "'", '\\': '\\' }

function readSingleQuoted(src: string, start: number): ReadString | null {
  let value = ''
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i]
    if (ch === '\\' && i + 1 < src.length) {
      const next = src[i + 1]
      value += ESCAPES[next] ?? `\\${next}`
      i++
    } else if (ch === "'") {
      return { value, end: i + 1 }
    } else {
      value += ch
    }
  }
  return null
}

function dedent(block: string): string {
  const lines = block.split('\n')
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => line.length - line.trimStart().length)
  const shared = indents.length ? Math.min(...indents) : 0
  return lines.map((line) => line.slice(shared)).join('\n')
}

function readTripleQuoted(src: string, start: number): ReadString | null {
  const close = src.indexOf("'''", start + 3)
  if (close === -1) return null
  return { value: dedent(src.slice(start + 3, close)), end: close + 3 }
}

function readDbmlString(src: string, start: number): ReadString | null {
  if (src.startsWith("'''", start)) return readTripleQuoted(src, start)
  if (src[start] === "'") return readSingleQuoted(src, start)
  return null
}

function readDoubleQuoted(src: string, start: number): ReadString | null {
  for (let i = start + 1; i < src.length; i++) {
    if (src[i] === '\\') i++
    else if (src[i] === '"') {
      return { value: src.slice(start + 1, i), end: i + 1 }
    }
  }
  return null
}

function skipSpaces(src: string, from: number): number {
  let i = from
  while (i < src.length && /\s/.test(src[i])) i++
  return i
}

function readNote(
  src: string,
  keywordStart: number
): { value: string; end: number } | null {
  const after = skipSpaces(src, keywordStart + 4)
  if (src[after] === ':') {
    return readDbmlString(src, skipSpaces(src, after + 1))
  }
  if (src[after] === '{') {
    const read = readDbmlString(src, skipSpaces(src, after + 1))
    if (!read) return null
    const close = skipSpaces(src, read.end)
    return src[close] === '}' ? { value: read.value, end: close + 1 } : null
  }
  return null
}

// Returns the index after a comment or non-note string starting at `i`, or `i`
// itself when nothing starts there (or the construct never closes).
function skipVerbatim(src: string, i: number): number {
  if (src.startsWith('//', i)) {
    const eol = src.indexOf('\n', i)
    return eol === -1 ? src.length : eol
  }
  if (src.startsWith('/*', i)) {
    const close = src.indexOf('*/', i + 2)
    return close === -1 ? i : close + 2
  }
  if (src[i] === "'" || src[i] === '"') {
    const read =
      src[i] === '"' ? readDoubleQuoted(src, i) : readDbmlString(src, i)
    return read ? read.end : i
  }
  return i
}

export function maskDbmlNotes(raw: string): MaskedDbml {
  const notes: string[] = []
  let text = ''
  let i = 0

  while (i < raw.length) {
    const skipped = skipVerbatim(raw, i)
    if (skipped > i) {
      text += raw.slice(i, skipped)
      i = skipped
      continue
    }
    const keyword = raw.slice(i).match(/^note/i)
    const isWordStart = i === 0 || !/\w/.test(raw[i - 1])
    if (keyword && isWordStart) {
      const read = readNote(raw, i)
      if (read) {
        notes.push(read.value)
        text += `${raw.slice(i, i + 4)}: __DBML_NOTE_${notes.length - 1}__`
        i = read.end
        continue
      }
    }
    text += raw[i]
    i++
  }

  return { text, notes }
}

export function resolveNote(
  notes: string[],
  fragment: string
): string | undefined {
  const match = fragment.match(NOTE_TOKEN_RE)
  return match ? notes[Number(match[1])] : undefined
}
