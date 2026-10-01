import { describe, expect, it } from 'vitest'
import corpus from '../fixtures/v1/manifest.json'
import { inlineNodesToMarkdown } from '../inlineNodesToMarkdown'
import { markdownToInlineNodes } from '../markdownToInlineNodes'
import { MarkdownToState } from '../markdownToState'
import StateToMarkdown from '../stateToMarkdown'

const fixtures = import.meta.glob('../fixtures/v1/*.md', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>

describe('versioned Markdown compatibility corpus', () => {
  for (const fixture of corpus.fixtures) {
    it(`round-trips ${fixture.id} byte-for-byte`, () => {
      const source = fixtures[`../fixtures/v1/${fixture.file}`]
      expect(source, `missing corpus fixture ${fixture.file}`).toBeDefined()

      const state = new MarkdownToState().generate(source!)
      expect(new StateToMarkdown().generate(state)).toBe(source)
      expect(['exact-byte', 'opaque']).toContain(fixture.classification)
    })
  }

  it('projects unsupported superscript syntax as an opaque inline node', () => {
    const source = fixtures['../fixtures/v1/inline-opaque.md']!
    const inline = markdownToInlineNodes(source)

    expect(
      inline.some(
        (node) => node.type === 'opaque-inline' && node.content === '~sup~'
      )
    ).toBe(true)
    expect(inlineNodesToMarkdown(inline)).toBe(source)
  })

  it.skipIf(typeof DOMParser === 'undefined')(
    'projects custom inline HTML as opaque source nodes',
    () => {
      const source = fixtures['../fixtures/v1/inline-html-opaque.md']!
      const inline = markdownToInlineNodes(source)
      const opaque = inline.filter((node) => node.type === 'opaque-inline')

      expect(opaque.map((node) => node.content)).toEqual(
        expect.arrayContaining(['<span data-x="1">raw</span>'])
      )
      expect(inlineNodesToMarkdown(inline)).toBe(source)
    }
  )
})
