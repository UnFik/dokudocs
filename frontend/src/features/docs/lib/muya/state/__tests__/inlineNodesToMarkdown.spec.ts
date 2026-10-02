import { describe, expect, it } from 'vitest'
import { tokenizer, tokensToPlainText } from '../../inlineRenderer/lexer'
import { inlineNodesToMarkdown } from '../inlineNodesToMarkdown'
import { markdownToInlineNodes } from '../markdownToInlineNodes'

describe('inlineNodesToMarkdown', () => {
  it('round-trips nested marks and direct links while their AST values match', () => {
    const source = '**bold *and italic*** [link](https://example.com "title")'
    expect(inlineNodesToMarkdown(markdownToInlineNodes(source))).toBe(source)
  })

  it('round-trips images, code, math, and escaped text', () => {
    const source = '![diagram](diagram.svg "Plan") `x` $a+b$ \\*literal\\*'
    expect(inlineNodesToMarkdown(markdownToInlineNodes(source))).toBe(source)
  })

  it('round-trips autolinks and resolved reference links', () => {
    const labels = new Map([
      ['docs', { href: 'https://example.org', title: 'Guide' }],
    ])
    const source = 'Visit <https://example.com> and [guide][docs].'
    expect(
      inlineNodesToMarkdown(markdownToInlineNodes(source, { labels }), {
        labels,
      })
    ).toBe(source)
  })

  it('rebuilds changed text and link targets from current AST values', () => {
    const nodes = markdownToInlineNodes('[old](https://old.example)')
    const link = nodes[0]!
    expect(link.type).toBe('run')
    if (link.type !== 'run') throw new Error('expected a run')
    link.content = 'new *label*'
    link.attributes.href = 'https://new.example'

    const markdown = inlineNodesToMarkdown(nodes)
    expect(markdown).toBe('[new \\*label\\*](https://new.example)')
    expect(tokensToPlainText(tokenizer(markdown))).toBe('new *label*')
    const parsed = markdownToInlineNodes(markdown)[0]!
    expect(parsed.type === 'run' && parsed.attributes.href).toBe(
      'https://new.example'
    )
  })

  it('escapes changed plain text instead of keeping stale source', () => {
    const nodes = markdownToInlineNodes('old')
    const node = nodes[0]!
    if (node.type !== 'run') throw new Error('expected a run')
    node.content = 'literal &amp; **text**'

    const markdown = inlineNodesToMarkdown(nodes)
    expect(tokensToPlainText(tokenizer(markdown))).toBe(
      'literal &amp; **text**'
    )
  })

  it('rebuilds image source, alt text, and title from current attributes', () => {
    const nodes = markdownToInlineNodes('![old](old.svg)')
    const node = nodes[0]!
    if (node.type !== 'image') throw new Error('expected an image')
    node.attributes.src = 'new.svg'
    node.attributes.alt = 'new]alt'
    node.attributes.title = 'new title'

    expect(inlineNodesToMarkdown(nodes)).toBe(
      '![new\\]alt](new.svg "new title")'
    )
  })

  it('keeps marks when edited text gains boundary whitespace', () => {
    const nodes = markdownToInlineNodes('**bold**')
    const node = nodes[0]!
    if (node.type !== 'run') throw new Error('expected a run')
    node.content = ' bold '

    const markdown = inlineNodesToMarkdown(nodes)
    expect(markdown).toBe('<strong> bold </strong>')
  })

  it('keeps unsupported syntax and line breaks intact', () => {
    const source = 'before ~sup~ after  \nnext'
    expect(inlineNodesToMarkdown(markdownToInlineNodes(source))).toBe(source)
  })

  it('emits opaque inline source without normalizing it', () => {
    const source = '<span data-x="1">raw</span>'
    expect(
      inlineNodesToMarkdown([
        { type: 'opaque-inline', content: source, attributes: {} },
      ])
    ).toBe(source)
  })

  it('does not silently emit inline code Muya cannot parse', () => {
    const node = {
      type: 'run',
      content: '```',
      attributes: { code: true },
    } as const
    expect(() => inlineNodesToMarkdown([node])).toThrow(/three backticks/)
  })
})
