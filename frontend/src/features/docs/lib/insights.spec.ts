import { describe, expect, it } from 'vitest'
import { revisionInsights } from './insights'

describe('revisionInsights', () => {
  it('counts saved versions and the people behind them', () => {
    expect(
      revisionInsights([
        { authorId: 'a' },
        { authorId: 'b' },
        { authorId: 'a' },
      ])
    ).toEqual({ versions: 3, contributors: 2 })
  })

  it('is zero for a page with no history', () => {
    expect(revisionInsights([])).toEqual({ versions: 0, contributors: 0 })
  })
})
