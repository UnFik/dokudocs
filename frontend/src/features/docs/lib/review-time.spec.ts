import { describe, expect, it } from 'vitest'
import { reviewTime } from './review-time'

const now = new Date(2026, 9, 7, 15, 0, 0)

describe('reviewTime', () => {
  it('says the time and Today for this day', () => {
    expect(reviewTime(new Date(2026, 9, 7, 14, 23).toISOString(), now)).toBe(
      '2:23 PM Today'
    )
  })

  it('says Yesterday for the day before', () => {
    expect(reviewTime(new Date(2026, 9, 6, 9, 5).toISOString(), now)).toBe(
      '9:05 AM Yesterday'
    )
  })

  it('gives the date for anything older', () => {
    expect(reviewTime(new Date(2026, 9, 1, 18, 30).toISOString(), now)).toBe(
      '6:30 PM Oct 1'
    )
    expect(reviewTime(new Date(2025, 11, 31, 8, 0).toISOString(), now)).toBe(
      '8:00 AM Dec 31, 2025'
    )
  })
})
