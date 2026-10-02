import { DOMSerializer } from 'prosemirror-model'
import { describe, expect, it } from 'vitest'
import { documentBodySchema } from './documentBody'

function renderedTag(type: string, bodyAttributes: string) {
  const node = documentBodySchema.nodes[type]!.create({
    nodeID: 'heading-1',
    bodyAttributes,
  })
  const dom = DOMSerializer.fromSchema(documentBodySchema).serializeNode(
    node
  ) as HTMLElement
  return dom.tagName.toLowerCase()
}

describe('heading render', () => {
  it.each([1, 2, 3, 4, 5, 6])('renders ATX level %i as h%i', (level) => {
    expect(renderedTag('atx_heading', JSON.stringify({ level }))).toBe(
      `h${level}`
    )
  })

  it.each(['{}', '{"level":0}', '{"level":9}', '{"level":"x"}', 'not json'])(
    'clamps invalid ATX attributes %s into h1-h6',
    (attributes) => {
      expect(renderedTag('atx_heading', attributes)).toMatch(/^h[1-6]$/)
    }
  )

  it('clamps out-of-range levels to the nearest heading', () => {
    expect(renderedTag('atx_heading', '{"level":9}')).toBe('h6')
    expect(renderedTag('atx_heading', '{"level":0}')).toBe('h1')
  })

  it('renders setext headings by level', () => {
    expect(
      renderedTag('setext_heading', '{"level":1,"underline":"==="}')
    ).toBe('h1')
    expect(
      renderedTag('setext_heading', '{"level":2,"underline":"---"}')
    ).toBe('h2')
  })
})
