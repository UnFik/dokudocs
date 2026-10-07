import { describe, expect, it } from 'vitest'
import { documentStats, sizeState } from './document-stats'

describe('documentStats', () => {
  it('counts words, characters, reading time, blocks and tasks of a Markdown text', () => {
    const markdown = [
      '# Title here',
      '',
      'One two three four five.',
      '',
      '- [x] done task',
      '- [ ] open task',
      '',
      '## Second',
      '',
      '```',
      'code words stay out of the count',
      '```',
    ].join('\n')
    const stats = documentStats(markdown)
    expect(stats.words).toBe(2 + 5 + 4 + 1) // Title here / One..five. / done task, open task / Second
    expect(stats.headings).toBe(2)
    expect(stats.tasks).toEqual({ done: 1, total: 2 })
    expect(stats.readingMinutes).toBe(1)
    expect(stats.characters).toBeGreaterThan(30)
  })

  it('is zero for an empty page', () => {
    expect(documentStats('')).toMatchObject({ words: 0, characters: 0, headings: 0, readingMinutes: 0 })
  })

  it('rounds reading time up at 200 words a minute', () => {
    expect(documentStats('word '.repeat(401)).readingMinutes).toBe(3)
  })
})

describe('sizeState', () => {
  it('warns near the limit and is full at it', () => {
    expect(sizeState(1000, 10_000)).toBe('ok')
    expect(sizeState(8000, 10_000)).toBe('warn')
    expect(sizeState(10_000, 10_000)).toBe('full')
  })
})
