import { describe, expect, it } from 'vitest'
import { toMarkdown } from '../src/markdown'

type J = Record<string, unknown>
const attrs = (extra: object = {}) => ({ nodeID: 'x', bodyAttributes: JSON.stringify(extra), bodyContent: '' })
const text = (value: string, marks: J[] = []) => ({ type: 'text', text: value, ...(marks.length ? { marks } : {}) })
const run = (...parts: J[]) => ({ type: 'run', attrs: attrs(), content: parts })
const paragraph = (...runs: J[]) => ({ type: 'paragraph', attrs: attrs(), content: runs })
const doc = (...blocks: J[]) => ({ type: 'doc', content: [{ type: 'document', attrs: attrs(), content: blocks }] })

// The derived Markdown keeps list previews, search and exports working; the
// JSON stays the source of truth.
describe('Markdown derived from the document JSON', () => {
  it('writes paragraphs separated by a blank line', () => {
    expect(toMarkdown(doc(paragraph(run(text('one'))), paragraph(run(text('two')))))).toBe('one\n\ntwo\n')
  })

  it('writes headings with their level', () => {
    const heading = { type: 'atx_heading', attrs: attrs({ level: 2 }), content: [run(text('Title'))] }
    expect(toMarkdown(doc(heading))).toBe('## Title\n')
  })

  it('writes inline marks and links', () => {
    const body = paragraph(
      run(text('plain '), text('bold', [{ type: 'strong' }]), text(' '), text('it', [{ type: 'em' }])),
      run(text('code', [{ type: 'code' }]), text(' '), text('gone', [{ type: 'strike' }])),
      run(text(' '), text('site', [{ type: 'link', attrs: { href: 'https://example.com', title: null } }]))
    )
    expect(toMarkdown(doc(body))).toBe('plain **bold** *it*`code` ~~gone~~ [site](https://example.com)\n')
  })

  it('writes underline and highlight as inline HTML', () => {
    const body = paragraph(
      run(text('u', [{ type: 'underline' }]), text(' '), text('h', [{ type: 'highlight' }]), text(' '), text('both', [{ type: 'underline' }, { type: 'highlight' }]))
    )
    expect(toMarkdown(doc(body))).toBe('<u>u</u> <mark>h</mark> <mark><u>both</u></mark>\n')
  })

  it('leaves out text that is only proposed by a suggestion', () => {
    const body = paragraph(run(text('kept'), text(' proposed', [{ type: 'suggestion_insert', attrs: { id: 'a', author: 'b' } }])))
    expect(toMarkdown(doc(body))).toBe('kept\n')
  })

  it('writes bullet, ordered and task lists, nested in quotes', () => {
    const item = (label: string, type = 'list_item', extra: object = {}) => ({
      type,
      attrs: attrs(extra),
      content: [paragraph(run(text(label)))],
    })
    const bullets = { type: 'bullet_list', attrs: attrs(), content: [item('a'), item('b')] }
    const ordered = { type: 'order_list', attrs: attrs({ start: 3 }), content: [item('c'), item('d')] }
    const tasks = {
      type: 'task_list',
      attrs: attrs(),
      content: [item('open', 'task_list_item', { checked: false }), item('done', 'task_list_item', { checked: true })],
    }
    const quote = { type: 'block_quote', attrs: attrs(), content: [paragraph(run(text('said')))] }
    expect(toMarkdown(doc(bullets, ordered, tasks, quote))).toBe(
      '- a\n- b\n\n3. c\n4. d\n\n- [ ] open\n- [x] done\n\n> said\n'
    )
  })

  it('writes code blocks, separators and tables', () => {
    const code = { type: 'code_block', attrs: attrs({ lang: 'ts' }), content: [text('const a = 1')] }
    const rule = { type: 'thematic_break', attrs: attrs() }
    const cell = (label: string) => ({ type: 'table_cell', attrs: attrs(), content: [run(text(label))] })
    const row = (...cells: J[]) => ({ type: 'table_row', attrs: attrs(), content: cells })
    const table = { type: 'table', attrs: attrs(), content: [row(cell('h1'), cell('h2')), row(cell('a'), cell('b'))] }
    expect(toMarkdown(doc(code, rule, table))).toBe(
      '```ts\nconst a = 1\n```\n\n---\n\n| h1 | h2 |\n| --- | --- |\n| a | b |\n'
    )
  })

  it('writes a mention of a person, a page and a project', () => {
    const mention = (kind: string, id: string, label: string) => ({
      type: 'mention',
      attrs: attrs({ kind, id, label }),
    })
    const body = paragraph(
      run(text('See ')),
      mention('person', 'u-1', 'Rina'),
      run(text(', ')),
      mention('document', 'd-1', 'Launch plan'),
      run(text(' and ')),
      mention('project', 'p-1', 'Apollo')
    )
    expect(toMarkdown(doc(body))).toBe('See @Rina, [Launch plan](/docs/d-1) and [Apollo](/projects/p-1)\n')
  })

  it('writes a notice, a toggle and a page break', () => {
    const notice = { type: 'notice', attrs: attrs({ variant: 'tip' }), content: [paragraph(run(text('Remember')))] }
    const toggle = {
      type: 'toggle',
      attrs: attrs(),
      content: [{ type: 'atx_heading', attrs: attrs({ level: 2 }), content: [run(text('More'))] }, paragraph(run(text('Inside')))],
    }
    const pageBreak = { type: 'page_break', attrs: attrs() }
    expect(toMarkdown(doc(notice, toggle, pageBreak))).toBe(
      ':::tip\nRemember\n:::\n\n+++\n## More\n\nInside\n+++\n\n<div class="page-break"></div>\n'
    )
  })

  it('writes an uploaded file as a link to it', () => {
    const file = { type: 'attachment', attrs: attrs({ src: '/api/v1/documents/d/assets/a', fileName: 'spec.pdf', contentType: 'application/pdf' }) }
    expect(toMarkdown(doc(file))).toBe('[spec.pdf](/api/v1/documents/d/assets/a)\n')
  })

  it('writes an embed as the address it shows', () => {
    const embed = { type: 'embed', attrs: attrs({ url: 'https://youtu.be/dQw4w9WgXcQ', provider: 'youtube' }) }
    expect(toMarkdown(doc(embed))).toBe('<https://youtu.be/dQw4w9WgXcQ>\n')
  })

  it('is empty for a document with no blocks', () => {
    expect(toMarkdown(doc())).toBe('')
  })
})
