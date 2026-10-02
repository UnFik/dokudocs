import { describe, expect, it } from 'vitest'
import { authorColor } from './author-color'

// The expected colors come from the backend's cursorColor (FNV-1a over the
// UUID's 16 bytes, modulo the 8-color palette), so a person has one color in
// cursors and in suggestions.
describe('authorColor', () => {
  it.each([
    ['00000000-0000-4000-8000-0000000000a1', '#15803D'],
    ['00000000-0000-4000-8000-0000000000a2', '#4D7C0F'],
    ['20000000-0000-4000-8000-000000000001', '#15803D'],
    ['f47ac10b-58cc-4372-a567-0e02b2c3d479', '#15803D'],
    ['ffffffff-ffff-4fff-bfff-ffffffffffff', '#0F766E'],
  ])('gives %s the backend color %s', (userID, color) => {
    expect(authorColor(userID)).toBe(color)
  })

  it('falls back to a palette color for something that is not a UUID', () => {
    expect(authorColor('not-a-uuid')).toMatch(/^#[0-9A-F]{6}$/)
  })
})
