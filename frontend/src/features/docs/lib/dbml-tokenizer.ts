function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export interface SearchMatch {
  start: number
  end: number
}

interface Token {
  type:
    | 'keyword'
    | 'type'
    | 'attribute'
    | 'attr-key'
    | 'string'
    | 'number'
    | 'comment'
    | 'operator'
    | 'text'
  value: string
  start: number
  end: number
}

const KEYWORDS = new Set([
  'Table',
  'Enum',
  'TableGroup',
  'Project',
  'Ref',
  'indexes',
  'Note',
])

const DATA_TYPES = new Set([
  'int',
  'bigint',
  'smallint',
  'varchar',
  'text',
  'boolean',
  'timestamp',
  'datetime',
  'date',
  'time',
  'json',
  'jsonb',
  'uuid',
  'decimal',
  'float',
  'double',
  'bytea',
  'serial',
  'integer',
])

const ATTRIBUTE_KEYWORDS = new Set([
  'pk',
  'increment',
  'unique',
  'not null',
  'null',
])

const ATTRIBUTE_KEYS = new Set([
  'default',
  'note',
  'name',
  'ref',
  'headercolor',
  'color',
  'fill',
])

function renderTokenValueWithMatches(
  tokenValue: string,
  tokenStart: number,
  tokenEnd: number,
  searchMatches?: SearchMatch[],
  activeMatchIndex?: number
): string {
  if (!searchMatches || searchMatches.length === 0) {
    return escapeHtml(tokenValue)
  }

  const overlapping: { start: number; end: number; isActive: boolean }[] = []
  for (let m = 0; m < searchMatches.length; m++) {
    const match = searchMatches[m]
    if (match.end > tokenStart && match.start < tokenEnd) {
      overlapping.push({
        start: Math.max(match.start, tokenStart) - tokenStart,
        end: Math.min(match.end, tokenEnd) - tokenStart,
        isActive: m === activeMatchIndex,
      })
    }
  }

  if (overlapping.length === 0) {
    return escapeHtml(tokenValue)
  }

  let html = ''
  let cursor = 0

  for (const o of overlapping) {
    if (o.start > cursor) {
      html += escapeHtml(tokenValue.substring(cursor, o.start))
    }
    const matchText = escapeHtml(tokenValue.substring(o.start, o.end))
    const markClass = o.isActive
      ? 'bg-amber-400/80 dark:bg-amber-400/60 ring-1 ring-amber-500 dark:ring-amber-300 font-bold text-foreground rounded-xs'
      : 'bg-yellow-400/40 dark:bg-yellow-400/30 text-foreground rounded-xs'
    html += `<mark class="${markClass}">${matchText}</mark>`
    cursor = o.end
  }

  if (cursor < tokenValue.length) {
    html += escapeHtml(tokenValue.substring(cursor))
  }

  return html
}

export function highlightDbml(
  code: string,
  searchMatches?: SearchMatch[],
  activeMatchIndex?: number
): string {
  if (!code) return ''

  const tokens: Token[] = []
  let i = 0
  const len = code.length

  while (i < len) {
    if (code[i] === '/' && code[i + 1] === '/') {
      const start = i
      while (i < len && code[i] !== '\n') {
        i++
      }
      tokens.push({
        type: 'comment',
        value: code.substring(start, i),
        start,
        end: i,
      })
      continue
    }

    if (code[i] === '/' && code[i + 1] === '*') {
      const start = i
      i += 2
      while (i < len && !(code[i - 1] === '*' && code[i] === '/')) {
        i++
      }
      if (i < len) i++
      tokens.push({
        type: 'comment',
        value: code.substring(start, i),
        start,
        end: i,
      })
      continue
    }

    if (code[i] === "'" || code[i] === '"' || code[i] === '`') {
      const quote = code[i]
      const start = i
      i++
      while (i < len && code[i] !== quote) {
        if (code[i] === '\\' && i + 1 < len) {
          i += 2
        } else {
          i++
        }
      }
      if (i < len) i++
      tokens.push({
        type: 'string',
        value: code.substring(start, i),
        start,
        end: i,
      })
      continue
    }

    if (code[i] === '[') {
      const bStart = i
      tokens.push({ type: 'operator', value: '[', start: bStart, end: bStart + 1 })
      i++

      while (i < len && code[i] !== ']') {
        if (code[i] === "'" || code[i] === '"' || code[i] === '`') {
          const quote = code[i]
          const start = i
          i++
          while (i < len && code[i] !== quote) {
            if (code[i] === '\\' && i + 1 < len) {
              i += 2
            } else {
              i++
            }
          }
          if (i < len) i++
          tokens.push({
            type: 'string',
            value: code.substring(start, i),
            start,
            end: i,
          })
          continue
        }

        if (
          code[i] === ':' ||
          code[i] === ',' ||
          code[i] === '>' ||
          code[i] === '<' ||
          code[i] === '-'
        ) {
          const oStart = i
          tokens.push({
            type: 'operator',
            value: code[i],
            start: oStart,
            end: oStart + 1,
          })
          i++
          continue
        }

        if (/\s/.test(code[i])) {
          const start = i
          while (i < len && /\s/.test(code[i]) && code[i] !== ']') {
            i++
          }
          tokens.push({
            type: 'text',
            value: code.substring(start, i),
            start,
            end: i,
          })
          continue
        }

        if (/[a-zA-Z_]/.test(code[i])) {
          const start = i
          while (i < len && /[a-zA-Z0-9_]/.test(code[i])) {
            i++
          }
          const word = code.substring(start, i)
          if (
            ATTRIBUTE_KEYWORDS.has(word) ||
            (word === 'not' && code.substring(i).trimStart().startsWith('null'))
          ) {
            tokens.push({ type: 'attribute', value: word, start, end: i })
          } else if (ATTRIBUTE_KEYS.has(word)) {
            tokens.push({ type: 'attr-key', value: word, start, end: i })
          } else {
            tokens.push({ type: 'text', value: word, start, end: i })
          }
          continue
        }

        const chStart = i
        tokens.push({ type: 'text', value: code[i], start: chStart, end: chStart + 1 })
        i++
      }

      if (i < len && code[i] === ']') {
        const bEnd = i
        tokens.push({ type: 'operator', value: ']', start: bEnd, end: bEnd + 1 })
        i++
      }
      continue
    }

    if (/[><\-:{}()]/.test(code[i])) {
      const oStart = i
      tokens.push({
        type: 'operator',
        value: code[i],
        start: oStart,
        end: oStart + 1,
      })
      i++
      continue
    }

    if (code[i] === '.') {
      const dStart = i
      tokens.push({ type: 'operator', value: '.', start: dStart, end: dStart + 1 })
      i++
      continue
    }

    if (/\d/.test(code[i])) {
      const start = i
      while (i < len && /\d/.test(code[i])) {
        i++
      }
      tokens.push({
        type: 'number',
        value: code.substring(start, i),
        start,
        end: i,
      })
      continue
    }

    if (/[a-zA-Z_]/.test(code[i])) {
      const start = i
      while (i < len && /[a-zA-Z0-9_]/.test(code[i])) {
        i++
      }
      const word = code.substring(start, i)

      if (KEYWORDS.has(word)) {
        tokens.push({ type: 'keyword', value: word, start, end: i })
      } else if (DATA_TYPES.has(word.toLowerCase())) {
        tokens.push({ type: 'type', value: word, start, end: i })
      } else {
        tokens.push({ type: 'text', value: word, start, end: i })
      }
      continue
    }

    const start = i
    while (i < len && !/[a-zA-Z0-9_'"/`[\].><\-:{}()]/.test(code[i])) {
      i++
    }
    tokens.push({ type: 'text', value: code.substring(start, i), start, end: i })
  }

  return tokens
    .map((token) => {
      const safe = renderTokenValueWithMatches(
        token.value,
        token.start,
        token.end,
        searchMatches,
        activeMatchIndex
      )
      switch (token.type) {
        case 'keyword':
          return `<span class="text-purple-600 dark:text-purple-400 font-semibold">${safe}</span>`
        case 'type':
          return `<span class="text-cyan-600 dark:text-cyan-400 font-medium">${safe}</span>`
        case 'attribute':
          return `<span class="text-amber-500 dark:text-amber-400 font-bold">${safe}</span>`
        case 'attr-key':
          return `<span class="text-blue-500 dark:text-blue-400 font-medium">${safe}</span>`
        case 'string':
          return `<span class="text-emerald-600 dark:text-emerald-400">${safe}</span>`
        case 'number':
          return `<span class="text-orange-500 dark:text-orange-400">${safe}</span>`
        case 'comment':
          return `<span class="text-zinc-500 dark:text-zinc-400 italic">${safe}</span>`
        case 'operator':
          return `<span class="text-zinc-400 dark:text-zinc-500 font-bold">${safe}</span>`
        default:
          return safe
      }
    })
    .join('')
}
