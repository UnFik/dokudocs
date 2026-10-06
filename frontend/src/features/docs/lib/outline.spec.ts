import { describe, expect, it } from 'vitest'
import type { DocumentBodyNode } from './documentBody'
import { activeHeadingID, outlineOf } from './outline'

let order = 0
const node = (
  nodeID: string,
  parentID: string | null,
  type: string,
  content = '',
  attributes: Record<string, unknown> = {}
): DocumentBodyNode => ({
  nodeID,
  parentID,
  siblingOrder: order++,
  type,
  content,
  attributes,
})

describe('outlineOf', () => {
  it('lists headings in document order with their level and text', () => {
    order = 0
    const nodes = [
      node('root', null, 'document'),
      node('h1', 'root', 'atx-heading', '', { level: 1 }),
      node('r1', 'h1', 'run', 'Intro'),
      node('p', 'root', 'paragraph'),
      node('r2', 'p', 'run', 'body text'),
      node('h2', 'root', 'atx-heading', '', { level: 2 }),
      node('r3', 'h2', 'run', 'Part '),
      node('r4', 'h2', 'run', 'one', { bold: true }),
    ]
    expect(outlineOf(nodes)).toEqual([
      { nodeID: 'h1', level: 1, text: 'Intro' },
      { nodeID: 'h2', level: 2, text: 'Part one' },
    ])
  })

  it('keeps an empty heading out of the list', () => {
    order = 0
    const nodes = [
      node('root', null, 'document'),
      node('h1', 'root', 'atx-heading', '', { level: 1 }),
    ]
    expect(outlineOf(nodes)).toEqual([])
  })

  it('reads setext headings too, and clamps a bad level', () => {
    order = 0
    const nodes = [
      node('root', null, 'document'),
      node('h1', 'root', 'setext-heading', '', { level: 2 }),
      node('r1', 'h1', 'run', 'Title'),
      node('h2', 'root', 'atx-heading', '', { level: 9 }),
      node('r2', 'h2', 'run', 'Deep'),
    ]
    expect(outlineOf(nodes).map((item) => item.level)).toEqual([2, 6])
  })
})

describe('activeHeadingID', () => {
  const positions = [
    { nodeID: 'a', top: -400 },
    { nodeID: 'b', top: -20 },
    { nodeID: 'c', top: 300 },
  ]

  it('is the last heading that has reached the top of the page', () => {
    expect(activeHeadingID(positions, 0)).toBe('b')
  })

  it('is the first heading before any has scrolled past', () => {
    expect(
      activeHeadingID(
        [
          { nodeID: 'a', top: 100 },
          { nodeID: 'b', top: 500 },
        ],
        0
      )
    ).toBe('a')
  })

  it('is nothing for a page with no headings', () => {
    expect(activeHeadingID([], 0)).toBeNull()
  })
})
