import { describe, expect, it } from 'vitest'
import {
  conversationMarkdown,
  formatTokens,
  resetLabel,
  shortAge,
  usagePercent,
} from './conversation-format'

const now = new Date('2026-10-12T12:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
const second = 1000
const minute = 60 * second
const hour = 60 * minute
const day = 24 * hour

describe('shortAge', () => {
  it.each([
    [0, 'now'],
    [5 * second, '5s'],
    [59 * second, '59s'],
    [60 * second, '1m'],
    [59 * minute, '59m'],
    [hour, '1h'],
    [23 * hour, '23h'],
    [day, '1d'],
    [29 * day, '29d'],
    [30 * day, '1mo'],
    [75 * day, '2mo'],
    [400 * day, '13mo'],
  ])('shows %i ms ago as %s', (elapsed, expected) => {
    expect(shortAge(ago(elapsed), now)).toBe(expected)
  })

  it('never shows a time in the future', () => {
    expect(shortAge(ago(-5 * minute), now)).toBe('now')
  })

  it('shows nothing for a date it cannot read', () => {
    expect(shortAge('not a date', now)).toBe('')
  })
})

describe('conversationMarkdown', () => {
  it('writes each question and answer in order, with the sources as titles', () => {
    const text = conversationMarkdown('Deploy checklist', [
      { role: 'user', content: 'How do I ship?' },
      {
        role: 'assistant',
        content: 'Run the release job.',
        citations: [
          { documentTitle: 'Runbook' },
          { documentTitle: 'Runbook' },
          { documentTitle: 'Postmortem' },
        ],
      },
    ])
    expect(text).toBe(
      [
        '# Deploy checklist',
        '',
        '## You',
        '',
        'How do I ship?',
        '',
        '## DokuDocs AI',
        '',
        'Run the release job.',
        '',
        'Sources: Runbook, Postmortem',
        '',
      ].join('\n')
    )
  })

  it('falls back to a plain heading for a chat without a title', () => {
    expect(conversationMarkdown('', [])).toBe('# Chat\n')
  })
})

describe('formatTokens', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1500, '1.5k'],
    [12_000, '12k'],
    [300_000, '300k'],
    [1_200_000, '1.2M'],
    [3_000_000, '3M'],
    [15_000_000, '15M'],
  ])('writes %i as %s', (count, expected) => {
    expect(formatTokens(count)).toBe(expected)
  })
})

describe('resetLabel', () => {
  it('names the first day of next month in UTC', () => {
    expect(resetLabel('2026-11-01T00:00:00Z')).toBe('Nov 1')
    expect(resetLabel('2027-01-01T00:00:00Z')).toBe('Jan 1')
  })

  it('shows nothing for a date it cannot read', () => {
    expect(resetLabel('later')).toBe('')
  })
})

describe('usagePercent', () => {
  it('rounds down and stops at 100', () => {
    expect(usagePercent({ used: 0, limit: 300_000 })).toBe(0)
    expect(usagePercent({ used: 1_200_000, limit: 3_000_000 })).toBe(40)
    expect(usagePercent({ used: 299_999, limit: 300_000 })).toBe(99)
    expect(usagePercent({ used: 450_000, limit: 300_000 })).toBe(100)
  })
})
