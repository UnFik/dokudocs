import { countTasks } from './count-tasks'

export type DocumentStats = {
  words: number
  characters: number
  readingMinutes: number
  headings: number
  tasks: { done: number; total: number }
}

/** Reading speed used for the estimate. */
const wordsPerMinute = 200

/** What the page holds, worked out from its Markdown. Code blocks are not read as prose. */
export function documentStats(markdown: string): DocumentStats {
  let inFence = false
  let words = 0
  let headings = 0
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (/^#{1,6}\s/.test(line)) headings++
    const prose = line
      .replace(/^\s*(?:#{1,6}|>|[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/, '')
      .replace(/[*_~`|]/g, ' ')
    words += prose.split(/\s+/).filter(Boolean).length
  }
  return {
    words,
    characters: markdown.length,
    readingMinutes:
      words === 0 ? 0 : Math.max(1, Math.ceil(words / wordsPerMinute)),
    headings,
    tasks: countTasks(markdown),
  }
}

/** How full a page is against the most it may hold: from 80% a warning, at the limit full. */
export function sizeState(
  characters: number,
  limit: number
): 'ok' | 'warn' | 'full' {
  if (characters >= limit) return 'full'
  return characters >= limit * 0.8 ? 'warn' : 'ok'
}

/** The most characters a page may hold. */
export const maxCharacters = 1_000_000
