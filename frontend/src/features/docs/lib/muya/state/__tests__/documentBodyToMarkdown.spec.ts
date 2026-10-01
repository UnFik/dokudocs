import { describe, expect, it } from 'vitest'
import {
  documentBodyToMarkdown,
  type DocumentBodyNode,
} from '../documentBodyToMarkdown'
import {
  enrichMuyaStateForBodyImport,
  type MuyaBodyImportState,
} from '../enrichMuyaStateForBodyImport'
import blockFixture from '../fixtures/body-import-blocks.json'
import corpus from '../fixtures/v1/manifest.json'
import { MarkdownToState } from '../markdownToState'
import { markdownToDocumentBody } from '../markdownToDocumentBody'
import ExportMarkdown from '../stateToMarkdown'
import type { TState } from '../types'

const fixtures = import.meta.glob('../fixtures/v1/*.md', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>

describe('documentBodyToMarkdown', () => {
  it('shares all block metadata with the Go body importer', () => {
    const source = [
      '---',
      'title: AST contract',
      '---',
      '',
      '# Heading',
      '',
      'Section',
      '=======',
      '',
      '4) ordered',
      '',
      '- [x] done',
      '',
      '> quoted',
      '',
      '| left | right |',
      '| --- | --- |',
      '| a | b |',
      '',
      '```ts title="example"',
      'const answer = 42',
      '```',
      '',
      '$$',
      'a + b',
      '$$',
      '',
      '```mermaid',
      'graph TD',
      '```',
      '',
      '[^note-1]: Footnote text',
    ].join('\n')
    const state = new MarkdownToState({
      footnote: true,
      math: true,
      isGitlabCompatibilityEnabled: true,
      trimUnnecessaryCodeBlockEmptyLines: false,
      frontMatter: true,
    }).generate(source)
    const enriched = enrichMuyaStateForBodyImport(state)

    expect(stripSourceMetadata(enriched)).toEqual(blockFixture)
    expect(documentBodyToMarkdown(flatten(enriched))).toBe(
      new ExportMarkdown().generate(state)
    )
  })

  for (const fixture of corpus.fixtures) {
    it.skipIf(
      fixture.id === 'inline-opaque' && typeof DOMParser === 'undefined'
    )(`round-trips AST fixture ${fixture.id} byte-for-byte`, async () => {
      expect(['exact-byte', 'opaque']).toContain(fixture.classification)
      const source = fixtures[`../fixtures/v1/${fixture.file}`]
      expect(source, `missing fixture ${fixture.file}`).toBeDefined()

      const body = await markdownToDocumentBody(
        '00000000-0000-4000-8000-000000000001',
        source!
      )

      expect(documentBodyToMarkdown(body.nodes)).toBe(source)
    })
  }

  it('exports nested AST blocks and inline nodes through Muya’s Markdown serializer', () => {
    const source = [
      '## Heading **bold**',
      '',
      'Paragraph *with* [reference][docs] &amp; escaped \\*text\\*.',
      '',
      '[docs]: https://example.com "Docs"',
      '',
      '- first',
      '- second',
    ].join('\n')
    const state = new MarkdownToState().generate(source)

    expect(
      documentBodyToMarkdown(flatten(enrichMuyaStateForBodyImport(state)))
    ).toBe(new ExportMarkdown().generate(state))
  })

  it('exports table, quote, and fenced code blocks', () => {
    const source = [
      '> quoted **text**',
      '',
      '| left | right |',
      '| --- | --- |',
      '| a | b |',
      '',
      '```ts title="example"',
      'const answer = 42',
      '```',
    ].join('\n')
    const state = new MarkdownToState().generate(source)

    expect(
      documentBodyToMarkdown(flatten(enrichMuyaStateForBodyImport(state)))
    ).toBe(new ExportMarkdown().generate(state))
  })

  it('exports setext headings, ordered/task lists, frontmatter, math, and footnotes', () => {
    const source = [
      '---',
      'title: Example',
      '---',
      '',
      'Section',
      '=======',
      '',
      '4) fourth',
      '5) fifth',
      '',
      '- [x] complete',
      '- [ ] pending',
      '',
      '$$',
      'a + b',
      '$$',
      '',
      'Reference[^1]',
      '',
      '[^1]: Footnote text',
    ].join('\n')
    const state = new MarkdownToState({
      footnote: true,
      math: true,
      isGitlabCompatibilityEnabled: true,
      trimUnnecessaryCodeBlockEmptyLines: false,
      frontMatter: true,
    }).generate(source)

    expect(stateNames(state)).toEqual(
      expect.arrayContaining([
        'frontmatter',
        'setext-heading',
        'order-list',
        'task-list',
        'math-block',
        'footnote',
      ])
    )
    expect(
      documentBodyToMarkdown(flatten(enrichMuyaStateForBodyImport(state)))
    ).toBe(new ExportMarkdown().generate(state))
  })

  it('exports raw HTML, thematic breaks, and diagrams', () => {
    const source = [
      '<section>',
      'raw html',
      '</section>',
      '',
      '---',
      '',
      '```mermaid',
      'graph TD',
      '  A --> B',
      '```',
    ].join('\n')
    const state = new MarkdownToState().generate(source)

    expect(stateNames(state)).toEqual(
      expect.arrayContaining(['html-block', 'thematic-break', 'diagram'])
    )
    expect(
      documentBodyToMarkdown(flatten(enrichMuyaStateForBodyImport(state)))
    ).toBe(new ExportMarkdown().generate(state))
  })

  it('preserves opaque block bytes and rejects malformed trees', () => {
    const root: DocumentBodyNode = {
      nodeID: 'root',
      parentID: null,
      siblingOrder: 0,
      type: 'document',
      content: '',
      attributes: {},
    }
    const opaque: DocumentBodyNode = {
      nodeID: 'opaque',
      parentID: 'root',
      siblingOrder: 0,
      type: 'opaque',
      content: 'unknown block',
      attributes: {},
    }
    opaque.content = ':::unknown\nraw bytes\n:::'
    expect(documentBodyToMarkdown([root, opaque])).toBe(opaque.content)

    const quote: DocumentBodyNode = {
      ...opaque,
      nodeID: 'quote',
      parentID: 'root',
      type: 'block-quote',
      content: '',
      attributes: {},
    }
    expect(
      documentBodyToMarkdown([root, quote, { ...opaque, parentID: 'quote' }])
    ).toBe('> :::unknown\n> raw bytes\n> :::')

    const list: DocumentBodyNode = {
      ...quote,
      nodeID: 'list',
      type: 'bullet-list',
      attributes: { marker: '-', loose: false },
    }
    const item: DocumentBodyNode = {
      ...quote,
      nodeID: 'item',
      parentID: 'list',
      type: 'list-item',
    }
    expect(
      documentBodyToMarkdown([
        root,
        list,
        item,
        { ...opaque, parentID: 'item' },
      ])
    ).toBe('- :::unknown\n  raw bytes\n  :::')

    expect(() =>
      documentBodyToMarkdown([
        root,
        { ...opaque, type: 'paragraph' },
        { ...opaque, nodeID: 'duplicate-order', type: 'paragraph' },
      ])
    ).toThrow('duplicate sibling order')
  })

  it('rejects malformed block metadata and nested inline nodes', () => {
    const root: DocumentBodyNode = {
      nodeID: 'root',
      parentID: null,
      siblingOrder: 0,
      type: 'document',
      content: '',
      attributes: {},
    }
    const orderedList: DocumentBodyNode = {
      nodeID: 'ordered-list',
      parentID: 'root',
      siblingOrder: 0,
      type: 'order-list',
      content: '',
      attributes: { start: 0, loose: false, delimiter: '.' },
    }
    const listItem: DocumentBodyNode = {
      nodeID: 'item',
      parentID: 'ordered-list',
      siblingOrder: 0,
      type: 'list-item',
      content: '',
      attributes: {},
    }
    expect(() => documentBodyToMarkdown([root, orderedList, listItem])).toThrow(
      'ordered list start must be a positive integer'
    )

    const paragraph: DocumentBodyNode = {
      ...listItem,
      nodeID: 'paragraph',
      parentID: 'root',
      type: 'paragraph',
    }
    const run: DocumentBodyNode = {
      ...listItem,
      nodeID: 'run',
      parentID: 'paragraph',
      type: 'run',
      content: 'text',
    }
    expect(() =>
      documentBodyToMarkdown([
        root,
        paragraph,
        run,
        { ...run, nodeID: 'nested-run', parentID: 'run' },
      ])
    ).toThrow('inline node run cannot have children')
  })
})

// The shared Go fixture covers block shape only; source gaps and compact
// tables travel as root attributes (see markdownToDocumentBody).
function testUUID(index: number) {
  return `00000000-0000-4000-8000-${(index + 2).toString(16).padStart(12, '0')}`
}

function stripSourceMetadata(
  states: MuyaBodyImportState[]
): MuyaBodyImportState[] {
  return states.map(({ sourceGap: _gap, sourceMarkdown: _table, ...rest }) => ({
    ...rest,
    ...(rest.children && { children: stripSourceMetadata(rest.children) }),
  }))
}

function flatten(states: MuyaBodyImportState[]): DocumentBodyNode[] {
  const sourceGaps: Record<string, string> = {}
  const sourceTables: Record<string, string> = {}
  const nodes: DocumentBodyNode[] = [
    {
      nodeID: 'root',
      parentID: null,
      siblingOrder: 0,
      type: 'document',
      content: '',
      attributes: {},
    },
  ]
  let nextID = 0

  function addStates(states: MuyaBodyImportState[], parentID: string) {
    for (let order = 0; order < states.length; order++) {
      const state = states[order]!
      const nodeID = testUUID(nextID++)
      if (state.sourceGap !== undefined) sourceGaps[nodeID] = state.sourceGap
      if (state.sourceMarkdown) sourceTables[nodeID] = state.sourceMarkdown
      nodes.push({
        nodeID,
        parentID,
        siblingOrder: order,
        type: state.name,
        content: state.text ?? '',
        attributes: state.meta ? { ...state.meta } : {},
      })
      for (
        let inlineOrder = 0;
        inlineOrder < (state.inline?.length ?? 0);
        inlineOrder++
      ) {
        const inline = state.inline![inlineOrder]!
        nodes.push({
          nodeID: testUUID(nextID++),
          parentID: nodeID,
          siblingOrder: inlineOrder,
          type: inline.type,
          content: 'content' in inline ? inline.content : '',
          attributes: { ...inline.attributes },
        })
      }
      if (state.children) addStates(state.children, nodeID)
    }
  }

  addStates(states, 'root')
  if (Object.keys(sourceGaps).length) nodes[0]!.attributes.sourceGaps = sourceGaps
  if (Object.keys(sourceTables).length)
    nodes[0]!.attributes.sourceTables = sourceTables
  return nodes
}

function stateNames(states: TState[]): string[] {
  return states.flatMap((state) => [
    state.name,
    ...('children' in state ? stateNames(state.children) : []),
  ])
}
