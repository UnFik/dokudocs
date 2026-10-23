import { describe, expect, it } from 'vitest'
import { peersFrom } from './use-architecture-session'

const me = 1
const ana = (pointer: { x: number; y: number } | null) => ({
  user: { userID: 'u-ana', name: 'Ana', color: '#f00' },
  selection: ['api'],
  pointer,
})

describe('the people in the room', () => {
  it('stay the same list while only this person moves their pointer', () => {
    const before = peersFrom(
      new Map<number, Record<string, unknown>>([
        [me, { user: { userID: 'u-me' }, pointer: { x: 0, y: 0 } }],
        [2, ana({ x: 10, y: 10 })],
      ]),
      me,
      []
    )
    const after = peersFrom(
      new Map<number, Record<string, unknown>>([
        [me, { user: { userID: 'u-me' }, pointer: { x: 50, y: 80 } }],
        [2, ana({ x: 10, y: 10 })],
      ]),
      me,
      before
    )
    expect(after).toBe(before)
  })

  it('show where someone else moved their pointer', () => {
    const before = peersFrom(
      new Map<number, Record<string, unknown>>([[2, ana({ x: 10, y: 10 })]]),
      me,
      []
    )
    const after = peersFrom(
      new Map<number, Record<string, unknown>>([[2, ana({ x: 40, y: 5 })]]),
      me,
      before
    )
    expect(after).toEqual([
      {
        clientID: 2,
        userID: 'u-ana',
        name: 'Ana',
        color: '#f00',
        selection: ['api'],
        pointer: { x: 40, y: 5 },
      },
    ])
  })
})
