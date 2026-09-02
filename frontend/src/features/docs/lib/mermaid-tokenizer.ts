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
    | 'diagram'
    | 'keyword'
    | 'direction'
    | 'participant'
    | 'note'
    | 'arrow'
    | 'delimiter'
    | 'string'
    | 'number'
    | 'comment'
    | 'text'
  value: string
  start: number
  end: number
}

const DIAGRAM_TYPES = new Set([
  'sequenceDiagram',
  'flowchart',
  'graph',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'gantt',
  'pie',
  'gitGraph',
  'mindmap',
  'timeline',
  'quadrantChart',
  'c4Context',
  'sankey-beta',
  'block-beta',
  'xychart-beta',
  'kanban',
  'architecture-beta',
])

const DIRECTIONS = new Set(['TD', 'TB', 'BT', 'RL', 'LR'])

const KEYWORDS = new Set([
  'autonumber',
  'participant',
  'actor',
  'boundary',
  'control',
  'entity',
  'database',
  'collections',
  'queue',
  'as',
  'Note',
  'over',
  'left of',
  'right of',
  'loop',
  'end',
  'alt',
  'else',
  'opt',
  'par',
  'and',
  'critical',
  'option',
  'break',
  'rect',
  'activate',
  'deactivate',
  'create',
  'destroy',
  'box',
  'links',
  'link',
  'subgraph',
  'classDef',
  'class',
  'style',
  'click',
  'callback',
  'linkStyle',
  'default',
  'interpolate',
  'title',
  'accTitle',
  'accDescr',
  'section',
  'dateFormat',
  'axisFormat',
  'showData',
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

  overlapping.sort((a, b) => a.start - b.start)

  let result = ''
  let cursor = 0

  for (const range of overlapping) {
    if (range.start > cursor) {
      result += escapeHtml(tokenValue.substring(cursor, range.start))
    }
    const matchText = tokenValue.substring(range.start, range.end)
    const cls = range.isActive
      ? 'bg-amber-400 text-black font-semibold rounded-xs shadow-xs px-0.5'
      : 'bg-yellow-300/45 dark:bg-yellow-500/35 text-foreground rounded-xs px-0.5'
    result += `<mark class="${cls}">${escapeHtml(matchText)}</mark>`
    cursor = Math.max(cursor, range.end)
  }

  if (cursor < tokenValue.length) {
    result += escapeHtml(tokenValue.substring(cursor))
  }

  return result
}

export function highlightMermaidCode(
  code: string,
  searchMatches?: SearchMatch[],
  activeMatchIndex?: number
): string {
  const lines = code.split('\n')
  let currentOffset = 0

  const highlightedLines = lines.map((line) => {
    const lineStart = currentOffset
    currentOffset += line.length + 1

    if (!line.trim()) {
      return ''
    }

    const trimmed = line.trimStart()
    const leadingWhitespace = line.substring(0, line.length - trimmed.length)

    if (trimmed.startsWith('%%')) {
      const commentContent = renderTokenValueWithMatches(
        trimmed,
        lineStart + leadingWhitespace.length,
        lineStart + line.length,
        searchMatches,
        activeMatchIndex
      )
      return `${leadingWhitespace}<span class="text-muted-foreground/60 italic font-mono">${commentContent}</span>`
    }

    const tokens: Token[] = []
    let i = 0
    const str = trimmed
    const baseOffset = lineStart + leadingWhitespace.length

    while (i < str.length) {
      const char = str[i]

      if (char === ' ' || char === '\t') {
        const start = i
        while (i < str.length && (str[i] === ' ' || str[i] === '\t')) {
          i++
        }
        tokens.push({
          type: 'text',
          value: str.substring(start, i),
          start: baseOffset + start,
          end: baseOffset + i,
        })
        continue
      }

      if (str.substring(i, i + 2) === '%%') {
        tokens.push({
          type: 'comment',
          value: str.substring(i),
          start: baseOffset + i,
          end: baseOffset + str.length,
        })
        break
      }

      if (char === '"' || char === "'") {
        const quote = char
        const start = i
        i++
        while (i < str.length && str[i] !== quote) {
          if (str[i] === '\\' && i + 1 < str.length) {
            i += 2
          } else {
            i++
          }
        }
        if (i < str.length) i++
        tokens.push({
          type: 'string',
          value: str.substring(start, i),
          start: baseOffset + start,
          end: baseOffset + i,
        })
        continue
      }

      const remaining = str.substring(i)
      const arrowMatch = remaining.match(
        /^(?:-->>|->>|--x|-x|--\)|-\)|==>|-\.->|-->|->|<-->|<->|--o|-o|o--o|x--x|::=)/
      )
      if (arrowMatch) {
        const val = arrowMatch[0]
        tokens.push({
          type: 'arrow',
          value: val,
          start: baseOffset + i,
          end: baseOffset + i + val.length,
        })
        i += val.length
        continue
      }

      if (
        char === '[' ||
        char === ']' ||
        char === '(' ||
        char === ')' ||
        char === '{' ||
        char === '}' ||
        char === ';' ||
        char === ':'
      ) {
        tokens.push({
          type: 'delimiter',
          value: char,
          start: baseOffset + i,
          end: baseOffset + i + 1,
        })
        i++
        continue
      }

      if (/[0-9]/.test(char) && (i === 0 || /[\s,([{:+-]/.test(str[i - 1]))) {
        const start = i
        while (i < str.length && /[0-9.]/.test(str[i])) {
          i++
        }
        tokens.push({
          type: 'number',
          value: str.substring(start, i),
          start: baseOffset + start,
          end: baseOffset + i,
        })
        continue
      }

      if (/[a-zA-Z0-9_]/.test(char)) {
        const start = i
        while (i < str.length && /[a-zA-Z0-9_]/.test(str[i])) {
          i++
        }
        const val = str.substring(start, i)
        let type: Token['type'] = 'text'

        if (DIAGRAM_TYPES.has(val)) {
          type = 'diagram'
        } else if (DIRECTIONS.has(val)) {
          type = 'direction'
        } else if (KEYWORDS.has(val)) {
          type = 'keyword'
        }

        tokens.push({
          type,
          value: val,
          start: baseOffset + start,
          end: baseOffset + i,
        })
        continue
      }

      tokens.push({
        type: 'text',
        value: char,
        start: baseOffset + i,
        end: baseOffset + i + 1,
      })
      i++
    }

    let lineHtml = leadingWhitespace
    tokens.forEach((tok) => {
      const rendered = renderTokenValueWithMatches(
        tok.value,
        tok.start,
        tok.end,
        searchMatches,
        activeMatchIndex
      )

      switch (tok.type) {
        case 'diagram':
          lineHtml += `<span class="text-purple-600 dark:text-purple-400 font-bold">${rendered}</span>`
          break
        case 'keyword':
          lineHtml += `<span class="text-cyan-600 dark:text-cyan-400 font-semibold">${rendered}</span>`
          break
        case 'direction':
          lineHtml += `<span class="text-amber-600 dark:text-amber-400 font-bold">${rendered}</span>`
          break
        case 'arrow':
          lineHtml += `<span class="text-emerald-600 dark:text-emerald-400 font-mono font-bold">${rendered}</span>`
          break
        case 'delimiter':
          lineHtml += `<span class="text-foreground/70 font-bold">${rendered}</span>`
          break
        case 'string':
          lineHtml += `<span class="text-emerald-600 dark:text-emerald-400 font-mono">${rendered}</span>`
          break
        case 'number':
          lineHtml += `<span class="text-amber-500 font-mono font-semibold">${rendered}</span>`
          break
        case 'comment':
          lineHtml += `<span class="text-muted-foreground/60 italic font-mono">${rendered}</span>`
          break
        default:
          lineHtml += `<span class="text-foreground/90 font-mono">${rendered}</span>`
      }
    })

    return lineHtml
  })

  return highlightedLines.join('\n')
}
