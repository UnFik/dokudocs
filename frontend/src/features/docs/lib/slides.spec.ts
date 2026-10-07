import { describe, expect, it } from 'vitest'
import { slidesOf } from './slides'

describe('slidesOf', () => {
  it('starts a new slide after each page break', () => {
    const markdown =
      'First\n\n<div class="page-break"></div>\n\nSecond\n\n<div class="page-break"></div>\n\nThird'
    expect(slidesOf(markdown)).toEqual(['First', 'Second', 'Third'])
  })

  it('splits at top and second level headings when there is no page break', () => {
    const markdown = '# One\n\ntext\n\n## Two\n\nmore\n\n### Not a split\n\nstill two'
    expect(slidesOf(markdown)).toEqual([
      '# One\n\ntext',
      '## Two\n\nmore\n\n### Not a split\n\nstill two',
    ])
  })

  it('does not split on headings inside a code fence', () => {
    const markdown = '# One\n\n```\n# not a heading\n```\n\n## Two'
    expect(slidesOf(markdown)).toHaveLength(2)
  })

  it('is one empty slide for an empty page', () => {
    expect(slidesOf('  \n')).toEqual([''])
  })
})
