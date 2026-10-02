import { describe, expect, it } from 'vitest'
import { enrichMuyaStateForBodyImport } from '../enrichMuyaStateForBodyImport'
import sharedFixture from '../fixtures/body-import-inline.json'
import referenceLinkFixture from '../fixtures/body-import-reference-link.json'
import { MarkdownToState } from '../markdownToState'
import type { TState } from '../types'

describe('enrichMuyaStateForBodyImport', () => {
  it('matches the shared Go importer fixture', () => {
    expect(
      enrichMuyaStateForBodyImport(
        new MarkdownToState().generate('**Ship** ~later~')
      )
    ).toEqual(sharedFixture)
  })

  it('resolves reference links and preserves their block definitions', () => {
    expect(
      enrichMuyaStateForBodyImport([
        ...new MarkdownToState().generate(
          'Read [guide][docs].\n\n[docs]: https://example.com "Docs"'
        ),
      ])
    ).toEqual(referenceLinkFixture)
  })

  it('adds inline nodes to text blocks and retains Muya block structure', () => {
    const state: TState[] = [
      { name: 'atx-heading', meta: { level: 1 }, text: 'Guide' },
      {
        name: 'bullet-list',
        meta: { marker: '-', loose: false },
        children: [
          {
            name: 'list-item',
            children: [{ name: 'paragraph', text: 'Use **AST**' }],
          },
        ],
      },
    ]

    expect(enrichMuyaStateForBodyImport(state)).toEqual([
      {
        name: 'atx-heading',
        meta: { level: 1 },
        text: 'Guide',
        inline: [
          {
            type: 'run',
            content: 'Guide',
            attributes: { source: 'Guide' },
          },
        ],
      },
      {
        name: 'bullet-list',
        meta: { marker: '-', loose: false },
        children: [
          {
            name: 'list-item',
            children: [
              {
                name: 'paragraph',
                text: 'Use **AST**',
                inline: [
                  {
                    type: 'run',
                    content: 'Use ',
                    attributes: { source: 'Use ' },
                  },
                  {
                    type: 'run',
                    content: 'AST',
                    attributes: {
                      bold: true,
                      boldMarker: '**',
                      source: 'AST',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ])
  })

  it('removes ATX marker syntax from canonical inline heading nodes', () => {
    const heading = new MarkdownToState().generate('## **AST**')[0]!

    expect(heading).toEqual({
      name: 'atx-heading',
      meta: { level: 2 },
      text: '## **AST**',
    })
    expect(enrichMuyaStateForBodyImport([heading])[0]).toMatchObject({
      inline: [
        {
          type: 'run',
          content: 'AST',
          attributes: { bold: true, boldMarker: '**', source: 'AST' },
        },
      ],
    })
  })

  it('keeps non-inline text blocks raw', () => {
    expect(
      enrichMuyaStateForBodyImport([
        { name: 'code-block', meta: { type: 'fenced', lang: 'ts' }, text: 'x' },
      ])
    ).toEqual([
      {
        name: 'code-block',
        meta: { type: 'fenced', lang: 'ts' },
        text: 'x',
      },
    ])
  })
})
