import { describe, expect, it } from 'vitest'
import { documentBodyToMarkdown } from '../documentBodyToMarkdown'
import { enrichMuyaStateForBodyImport } from '../enrichMuyaStateForBodyImport'
import bootstrapFixture from '../fixtures/body-import-bootstrap.json'
import sourceGapFixture from '../fixtures/body-import-source-gap.json'
import sourceTableFixture from '../fixtures/body-import-source-table.json'
import tightSourceGapFixture from '../fixtures/body-import-tight-gap.json'
import { markdownToDocumentBody } from '../markdownToDocumentBody'
import { MarkdownToState } from '../markdownToState'
import ExportMarkdown from '../stateToMarkdown'

const documentID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'

describe('markdownToDocumentBody', () => {
  it('creates a stable AST that serializes like the Muya parser', async () => {
    const markdown = '# **Plan**\n\n- [x] ship\n'
    const body = await markdownToDocumentBody(documentID, markdown)
    const retry = await markdownToDocumentBody(documentID, markdown)
    const state = new MarkdownToState({
      footnote: false,
      math: true,
      isGitlabCompatibilityEnabled: false,
      trimUnnecessaryCodeBlockEmptyLines: false,
      frontMatter: true,
    }).generate(markdown)

    expect(retry).toEqual(body)
    expect(enrichMuyaStateForBodyImport(state)).toEqual(bootstrapFixture)
    expect(body.nodes.map((node) => node.nodeID)).toEqual([
      '86ba28c5-daf4-53ec-b583-0a72ee65b38c',
      '4ac70c64-ac57-5399-a623-0d7f72b54bf8',
      'e45ea7b4-a85c-5198-8636-1c04fef67465',
      'f45019f5-ab8a-5061-abbf-588a9652f644',
      'ba5a5165-8355-57c4-a1c8-bcad0491bdc7',
      'bbbdf10f-2eaf-53ad-a455-63d695eb7aca',
      '6bf4e016-d4eb-5370-9578-a2b8da9d4189',
    ])
    expect(body.nodes[0]).toMatchObject({
      nodeID: body.rootNodeID,
      parentID: null,
      type: 'document',
    })
    expect(documentBodyToMarkdown(body.nodes)).toBe(
      new ExportMarkdown().generate(state)
    )
    expect(documentBodyToMarkdown(body.nodes)).toBe(markdown)
  })

  it('imports legacy documents with PostgreSQL-valid non-RFC UUIDs', async () => {
    const body = await markdownToDocumentBody(
      '00000000-0000-0000-0000-000000000031',
      '# Legacy source\n'
    )

    expect(documentBodyToMarkdown(body.nodes)).toBe('# Legacy source\n')
  })

  it('shares source gap metadata with the Go importer', async () => {
    const markdown = 'first\n\n\nsecond\n'
    const body = await markdownToDocumentBody(documentID, markdown)
    const state = new MarkdownToState({
      footnote: false,
      math: true,
      isGitlabCompatibilityEnabled: false,
      trimUnnecessaryCodeBlockEmptyLines: false,
      frontMatter: true,
    }).generate(markdown)

    expect(enrichMuyaStateForBodyImport(state)).toEqual(sourceGapFixture)
    expect(body.nodes[3]!.nodeID).toBe('5292761d-67da-50fb-aae1-d90ef0b55fde')
    expect(body.nodes[0]!.attributes.sourceGaps).toEqual({
      [body.nodes[3]!.nodeID]: '\n\n\n',
    })
  })

  it('shares empty tight-gap metadata with the Go importer', async () => {
    const markdown = '# heading\n- item'
    const body = await markdownToDocumentBody(documentID, markdown)
    const state = new MarkdownToState({
      footnote: false,
      math: true,
      isGitlabCompatibilityEnabled: false,
      trimUnnecessaryCodeBlockEmptyLines: false,
      frontMatter: true,
    }).generate(markdown)
    const list = body.nodes.find((node) => node.type === 'bullet-list')!

    expect(enrichMuyaStateForBodyImport(state)).toEqual(tightSourceGapFixture)
    expect(body.nodes[0]!.attributes.sourceGaps).toEqual({
      [list.nodeID]: '',
    })
    expect(documentBodyToMarkdown(body.nodes)).toBe(markdown)
  })

  it('preserves source table formatting through the Go importer contract', async () => {
    const markdown = '|a|b|\n|---|---|\n|x|y|'
    const body = await markdownToDocumentBody(documentID, markdown)
    const state = new MarkdownToState({
      footnote: false,
      math: true,
      isGitlabCompatibilityEnabled: false,
      trimUnnecessaryCodeBlockEmptyLines: false,
      frontMatter: true,
    }).generate(markdown)
    const tableNode = body.nodes.find((node) => node.type === 'table')!

    expect(enrichMuyaStateForBodyImport(state)).toEqual(sourceTableFixture)
    expect(body.nodes[0]!.attributes.sourceTables).toEqual({
      [tableNode.nodeID]: markdown,
    })
    expect(documentBodyToMarkdown(body.nodes)).toBe(markdown)
  })

  it('does not let preserved table source override edited cells', async () => {
    const markdown = '|a|b|\n|---|---|\n|x|y|'
    const body = await markdownToDocumentBody(documentID, markdown)
    const nodes = body.nodes.map((node) =>
      node.type === 'run' && node.content === 'x'
        ? { ...node, content: 'updated' }
        : node
    )
    const exported = documentBodyToMarkdown(nodes)

    expect(exported).toContain('updated')
    expect(exported).not.toContain('|a|b|')
  })

  it.each([
    '# title',
    '# title\n\n',
    '',
    'first\n\n\nsecond\n',
    'first\n  \n\nsecond\n',
    '> first\n>\n>\n> second\n',
    '# heading\n- item',
    ' # leading heading',
    '# heading\n\n # indented heading',
    '# heading\n- item',
    '- first\n\n\n- second\n',
    '> - first\n> \n> \n> - second\n',
  ])('preserves Markdown source whitespace', async (markdown) => {
    const body = await markdownToDocumentBody(documentID, markdown)

    expect(documentBodyToMarkdown(body.nodes)).toBe(markdown)
  })
})
