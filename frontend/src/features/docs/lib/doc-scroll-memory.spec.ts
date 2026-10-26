import { afterEach, describe, expect, it, vi } from 'vitest'
import { recallScroll, rememberScroll } from './doc-scroll-memory'

const now = Date.UTC(2026, 9, 26)
const spot = { top: 1200, nodeId: 'node-7', offset: 24 }

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('document scroll memory', () => {
  it('gives back where the person was reading, once', () => {
    rememberScroll('user-1', 'doc-1', spot, now)
    expect(recallScroll('user-1', 'doc-1', now + 1000)).toEqual(spot)
    expect(recallScroll('user-1', 'doc-1', now + 1000)).toBeNull()
  })
  it('keeps each document apart', () => {
    rememberScroll('user-1', 'doc-1', spot, now)
    expect(recallScroll('user-1', 'doc-2', now)).toBeNull()
    expect(recallScroll('user-1', 'doc-1', now)).toEqual(spot)
  })
  it('does not hand a position to another person who signs in next', () => {
    rememberScroll('user-1', 'doc-1', spot, now)
    expect(recallScroll('user-2', 'doc-1', now)).toBeNull()
  })
  it('forgets a position after a week', () => {
    rememberScroll('user-1', 'doc-1', spot, now)
    expect(
      recallScroll('user-1', 'doc-1', now + 7 * 24 * 3600 * 1000 + 1)
    ).toBeNull()
  })
  it('ignores a damaged entry', () => {
    sessionStorage.setItem('dokudocs:doc-scroll:doc-1', '{nope')
    expect(recallScroll('user-1', 'doc-1', now)).toBeNull()
  })
  it('works without storage', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => rememberScroll('user-1', 'doc-1', spot, now)).not.toThrow()
    expect(recallScroll('user-1', 'doc-1', now)).toBeNull()
  })
})
