import { describe, expect, it } from 'vitest'
import { markdownToInlineNodes } from '../markdownToInlineNodes'

describe('markdownToInlineNodes', () => {
  it('projects nested marks and links into runs with semantic attributes', () => {
    expect(
      markdownToInlineNodes(
        '**bold *and italic*** [link](https://example.com "title")'
      )
    ).toEqual([
      {
        type: 'run',
        content: 'bold ',
        attributes: { bold: true, boldMarker: '**', source: 'bold ' },
      },
      {
        type: 'run',
        content: 'and italic',
        attributes: {
          bold: true,
          boldMarker: '**',
          italic: true,
          italicMarker: '*',
          source: 'and italic',
        },
      },
      { type: 'run', content: ' ', attributes: { source: ' ' } },
      {
        type: 'run',
        content: 'link',
        attributes: {
          href: 'https://example.com',
          linkTitle: 'title',
          linkSource: '[link](https://example.com "title")',
          source: 'link',
        },
      },
    ])
  })

  it('preserves images, inline code, math, and escaped visible text', () => {
    expect(
      markdownToInlineNodes(
        '![diagram](diagram.svg "Plan") `x` $a+b$ \\*literal\\*'
      )
    ).toEqual([
      {
        type: 'image',
        attributes: {
          src: 'diagram.svg',
          alt: 'diagram',
          title: 'Plan',
          source: '![diagram](diagram.svg "Plan")',
        },
      },
      { type: 'run', content: ' ', attributes: { source: ' ' } },
      {
        type: 'run',
        content: 'x',
        attributes: { code: true, codeMarker: '`', source: '`x`' },
      },
      { type: 'run', content: ' ', attributes: { source: ' ' } },
      {
        type: 'math',
        content: 'a+b',
        attributes: { marker: '$', source: '$a+b$' },
      },
      {
        type: 'run',
        content: ' *literal*',
        attributes: { source: ' \\*literal\\*' },
      },
    ])
  })

  it('retains autolink and reference-link source metadata', () => {
    expect(
      markdownToInlineNodes('Visit <https://example.com> and [guide][docs].', {
        labels: new Map([
          ['docs', { href: 'https://example.org', title: 'Guide' }],
        ]),
      })
    ).toEqual([
      {
        type: 'run',
        content: 'Visit ',
        attributes: { source: 'Visit ' },
      },
      {
        type: 'run',
        content: 'https://example.com',
        attributes: {
          href: 'https://example.com',
          source: '<https://example.com>',
        },
      },
      {
        type: 'run',
        content: ' and ',
        attributes: { source: ' and ' },
      },
      {
        type: 'run',
        content: 'guide',
        attributes: {
          href: 'https://example.org',
          linkTitle: 'Guide',
          referenceLabel: 'docs',
          linkSource: '[guide][docs]',
          source: 'guide',
        },
      },
      { type: 'run', content: '.', attributes: { source: '.' } },
    ])
  })

  it('consumes heading syntax only when the caller identifies block markers', () => {
    expect(
      markdownToInlineNodes('# Heading *emphasis*', { hasBeginRules: true })
    ).toEqual([
      {
        type: 'run',
        content: 'Heading ',
        attributes: { source: 'Heading ' },
      },
      {
        type: 'run',
        content: 'emphasis',
        attributes: { italic: true, italicMarker: '*', source: 'emphasis' },
      },
    ])
    expect(markdownToInlineNodes('# literal')).toEqual([
      {
        type: 'run',
        content: '# literal',
        attributes: { source: '# literal' },
      },
    ])
  })

  it('preserves unsupported inline syntax as opaque source', () => {
    expect(markdownToInlineNodes('before ~sup~ after')).toEqual([
      {
        type: 'run',
        content: 'before ',
        attributes: { source: 'before ' },
      },
      { type: 'opaque-inline', content: '~sup~', attributes: {} },
      { type: 'run', content: ' after', attributes: { source: ' after' } },
    ])
  })
})
