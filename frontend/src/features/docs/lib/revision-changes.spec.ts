import { describe, expect, it } from 'vitest'
import { changesBetween } from './revision-changes'

describe('changesBetween', () => {
  it('lists the lines added and removed, in page order', () => {
    expect(
      changesBetween('one\ntwo\nthree', 'one\n2\nthree\nfour')
    ).toEqual([
      { kind: 'removed', text: 'two' },
      { kind: 'added', text: '2' },
      { kind: 'added', text: 'four' },
    ])
  })

  it('is empty when nothing changed', () => {
    expect(changesBetween('same\nlines', 'same\nlines')).toEqual([])
  })

  it('treats a first version as all added', () => {
    expect(changesBetween('', 'a\nb')).toEqual([
      { kind: 'added', text: 'a' },
      { kind: 'added', text: 'b' },
    ])
  })
})
