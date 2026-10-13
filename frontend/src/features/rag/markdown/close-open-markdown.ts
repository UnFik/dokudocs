const FENCE = /^ {0,3}(`{3,}|~{3,})/

/**
 * Makes half-written Markdown safe to draw while an answer streams in: a code
 * fence still open is closed, inline markers still open are closed (or dropped
 * when nothing follows them yet), and a link that is not finished shows its
 * label. Finished Markdown comes back unchanged.
 */
export function closeOpenMarkdown(text: string): string {
  const lines = text.split('\n')
  let fence: string | undefined
  let paragraphStart = 0
  lines.forEach((line, index) => {
    const marker = FENCE.exec(line)?.[1]
    if (fence) {
      if (
        marker &&
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        line.trim() === marker
      ) {
        fence = undefined
        paragraphStart = index + 1
      }
      return
    }
    if (marker) {
      fence = marker
      return
    }
    if (line.trim() === '') paragraphStart = index + 1
  })
  if (fence) return `${text}\n${fence}`

  const head = lines.slice(0, paragraphStart)
  const paragraph = lines.slice(paragraphStart).join('\n')
  const repaired = closeInline(unfinishedLink(paragraph))
  return repaired === paragraph ? text : [...head, repaired].join('\n')
}

function unfinishedLink(text: string): string {
  const withUrl = /\[([^\]\n]*)\]\([^)\n]*$/.exec(text)
  if (withUrl) return text.slice(0, withUrl.index) + withUrl[1]
  const label = /\[([^\]\n]*)$/.exec(text)
  if (label) return text.slice(0, label.index) + label[1]
  return text
}

type Opener = { marker: string; index: number }

function closeInline(text: string): string {
  const open: Opener[] = []
  let code: number | undefined
  let i = 0
  while (i < text.length) {
    const char = text[i]
    if (char === '\\') {
      i += 2
      continue
    }
    if (char === '`') {
      code = code === undefined ? i : undefined
      i++
      continue
    }
    if (code !== undefined) {
      i++
      continue
    }
    const marker = ['**', '~~', '*'].find((m) => text.startsWith(m, i))
    if (!marker) {
      i++
      continue
    }
    const at = open.findIndex((item) => item.marker === marker)
    if (at >= 0) {
      open.splice(at, open.length - at)
    } else if (opensEmphasis(text, i, marker)) {
      open.push({ marker, index: i })
    }
    i += marker.length
  }

  let result = text
  const unclosed: Opener[] = [...open]
  if (code !== undefined) unclosed.push({ marker: '`', index: code })
  unclosed.sort((a, b) => b.index - a.index)
  for (const { marker, index } of unclosed) {
    result =
      result.slice(index + marker.length).trim() === ''
        ? result.slice(0, index)
        : result + marker
  }
  return result
}

/** A star opens emphasis only when text follows it; `2 * 3` and `* item` do not. */
function opensEmphasis(text: string, at: number, marker: string): boolean {
  const next = text[at + marker.length]
  if (marker === '*' && next !== undefined && /\s/.test(next)) return false
  const lineStart = text.lastIndexOf('\n', at - 1) + 1
  if (marker === '*' && text.slice(lineStart, at).trim() === '' && next === ' ')
    return false
  return true
}
