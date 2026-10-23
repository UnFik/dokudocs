import { describe, expect, it } from 'vitest'
import { AgentEditError, applyMarkdownOperations, applySourceOperations, textVersion } from '../src/agent-edit'
import { validateSuggesterChange } from '../src/suggestion-validator'
import { toMarkdown } from '../src/markdown'

type J = Record<string, any>
const ME = '00000000-0000-4000-8000-0000000000a1'
const text = (value: string, marks: J[] = []) => ({ type: 'text', text: value, ...(marks.length ? { marks } : {}) })
const run = (id: string, ...parts: J[]) => ({ type: 'run', attrs: { nodeID: id, bodyAttributes: '{}', bodyContent: '' }, content: parts })
const block = (type: string, id: string, attributes: J, ...runs: J[]) => ({
  type,
  attrs: { nodeID: id, bodyAttributes: JSON.stringify(attributes), bodyContent: '' },
  content: runs,
})
const paragraph = (id: string, value: string) => block('paragraph', id, {}, run(`${id}-r`, text(value)))
const heading = (id: string, value: string, level = 2) => block('atx_heading', id, { level }, run(`${id}-r`, text(value)))
const doc = (...blocks: J[]) => ({
  type: 'doc',
  content: [{ type: 'document', attrs: { nodeID: 'root', bodyAttributes: '{}', bodyContent: '' }, content: blocks }],
})
const base = () =>
  doc(heading('h1', 'Overview', 1), paragraph('p1', 'The API runs on one server.'), heading('h2', 'Deploy'), paragraph('p2', 'Push to main.'))
let counter = 0
const ids = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

describe('direct markdown edits', () => {
  it('replaces a unique piece of text', () => {
    const { json } = applyMarkdownOperations(base(), [{ type: 'replace_text', find: 'one server', replace: 'two servers' }], { mode: 'direct', author: ME, newID: ids })
    expect(toMarkdown(json)).toContain('The API runs on two servers.')
    expect(toMarkdown(json)).not.toContain('one server')
  })

  it('refuses text that is missing or appears more than once', () => {
    expect(() => applyMarkdownOperations(base(), [{ type: 'replace_text', find: 'nowhere', replace: 'x' }], { mode: 'direct', author: ME, newID: ids })).toThrow(AgentEditError)
    const twice = doc(paragraph('a', 'same words'), paragraph('b', 'same words'))
    expect(() => applyMarkdownOperations(twice, [{ type: 'replace_text', find: 'same', replace: 'x' }], { mode: 'direct', author: ME, newID: ids })).toThrow(/2 times/)
  })

  it('inserts paragraphs right after a heading', () => {
    const { json } = applyMarkdownOperations(base(), [{ type: 'insert_after_heading', heading: 'deploy', text: 'Run the tests first.\n\nThen tag a release.' }], { mode: 'direct', author: ME, newID: ids })
    const markdown = toMarkdown(json)
    expect(markdown.indexOf('Run the tests first.')).toBeGreaterThan(markdown.indexOf('Deploy'))
    expect(markdown.indexOf('Then tag a release.')).toBeLessThan(markdown.indexOf('Push to main.'))
  })

  it('appends a section with a heading at the end', () => {
    const { json } = applyMarkdownOperations(base(), [{ type: 'append_section', heading: 'Rollback', level: 2, text: 'Restore the last backup.' }], { mode: 'direct', author: ME, newID: ids })
    expect(toMarkdown(json).trimEnd().endsWith('## Rollback\n\nRestore the last backup.')).toBe(true)
  })

  it('applies operations in order and refuses an unknown one', () => {
    const { json } = applyMarkdownOperations(
      base(),
      [
        { type: 'replace_text', find: 'Push to main.', replace: 'Push to the release branch.' },
        { type: 'replace_text', find: 'release branch', replace: 'stable branch' },
      ],
      { mode: 'direct', author: ME, newID: ids }
    )
    expect(toMarkdown(json)).toContain('Push to the stable branch.')
    expect(() => applyMarkdownOperations(base(), [{ type: 'delete_everything' } as never], { mode: 'direct', author: ME, newID: ids })).toThrow(AgentEditError)
  })
})

describe('suggested markdown edits', () => {
  it('marks the old text deleted and the new text inserted, in the author’s name, and passes the suggester check', () => {
    const before = base()
    const { json, suggestionIDs } = applyMarkdownOperations(before, [{ type: 'replace_text', find: 'one server', replace: 'two servers' }], { mode: 'suggest', author: ME, newID: ids })
    expect(suggestionIDs).toHaveLength(1)
    expect(validateSuggesterChange(before, json, ME)).toEqual({ ok: true })
    const serialized = JSON.stringify(json)
    expect(serialized).toContain('suggestion_delete')
    expect(serialized).toContain('suggestion_insert')
    expect(serialized).toContain(ME)
  })

  it('proposes new paragraphs and sections as block insertions that pass the suggester check', () => {
    const before = base()
    const { json, suggestionIDs } = applyMarkdownOperations(
      before,
      [
        { type: 'insert_after_heading', heading: 'Deploy', text: 'Run the tests first.' },
        { type: 'append_section', heading: 'Rollback', text: 'Restore the last backup.' },
      ],
      { mode: 'suggest', author: ME, newID: ids }
    )
    expect(suggestionIDs.length).toBeGreaterThanOrEqual(2)
    expect(validateSuggesterChange(before, json, ME)).toEqual({ ok: true })
  })
})

describe('source edits', () => {
  const source = 'Table users {\n  id int\n}\n'
  it('replaces unique text, replaces all, or appends', () => {
    expect(applySourceOperations(source, [{ type: 'replace_text', find: 'id int', replace: 'id uuid' }])).toBe('Table users {\n  id uuid\n}\n')
    expect(applySourceOperations(source, [{ type: 'replace_all', text: 'Table t {}' }])).toBe('Table t {}')
    expect(applySourceOperations(source, [{ type: 'append', text: 'Table posts {}' }])).toBe(`${source}Table posts {}`)
    expect(() => applySourceOperations(source, [{ type: 'replace_text', find: 'missing', replace: 'x' }])).toThrow(AgentEditError)
  })
})

describe('versions', () => {
  it('change with the text and stay the same for the same text', () => {
    expect(textVersion('a')).toBe(textVersion('a'))
    expect(textVersion('a')).not.toBe(textVersion('b'))
    expect(textVersion('a')).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('section edits', () => {
  const sections = () =>
    doc(
      heading('h1', 'Overview', 1),
      paragraph('p1', 'The API runs on one server.'),
      heading('h2', 'Deploy'),
      paragraph('p2', 'Push to main.'),
      heading('h3', 'Steps', 3),
      paragraph('p3', 'Tag a release.'),
      heading('h4', 'Rollback'),
      paragraph('p4', 'Restore the backup.')
    )
  const direct = { mode: 'direct', author: ME, newID: ids } as const
  const suggest = { mode: 'suggest', author: ME, newID: ids } as const

  it('replaces everything under a heading, including its subsections, and keeps the next section', () => {
    const { json } = applyMarkdownOperations(sections(), [{ type: 'replace_section', heading: 'Deploy', text: 'Use the pipeline.\n\nNo manual pushes.' }], direct)
    const markdown = toMarkdown(json)
    expect(markdown).toContain('## Deploy\n\nUse the pipeline.\n\nNo manual pushes.\n\n## Rollback')
    expect(markdown).not.toContain('Push to main.')
    expect(markdown).not.toContain('Tag a release.')
  })

  it('deletes a section with its heading', () => {
    const { json } = applyMarkdownOperations(sections(), [{ type: 'delete_section', heading: 'Steps' }], direct)
    const markdown = toMarkdown(json)
    expect(markdown).not.toContain('Steps')
    expect(markdown).toContain('Push to main.')
    expect(markdown).toContain('## Rollback')
  })

  it('inserts before a heading and appends plain paragraphs at the end', () => {
    const { json } = applyMarkdownOperations(
      sections(),
      [
        { type: 'insert_before_heading', heading: 'Rollback', text: 'Before you roll back, tell the team.' },
        { type: 'append', text: 'The end.' },
      ],
      direct
    )
    const markdown = toMarkdown(json)
    expect(markdown.indexOf('tell the team')).toBeLessThan(markdown.indexOf('## Rollback'))
    expect(markdown.trimEnd().endsWith('The end.')).toBe(true)
  })

  it('proposes a section replacement as suggestions that pass the suggester check', () => {
    const before = sections()
    const { json, suggestionIDs } = applyMarkdownOperations(
      before,
      [
        { type: 'replace_section', heading: 'Deploy', text: 'Use the pipeline.' },
        { type: 'delete_section', heading: 'Rollback' },
      ],
      suggest
    )
    expect(suggestionIDs.length).toBeGreaterThanOrEqual(4)
    expect(JSON.stringify(json)).toContain('\\"kind\\":\\"delete\\"')
    expect(validateSuggesterChange(before, json, ME)).toEqual({ ok: true })
  })

  it('names the sections when a text appears more than once, and says when only spacing differs', () => {
    const twice = doc(heading('a', 'First'), paragraph('b', 'same words'), heading('c', 'Second'), paragraph('d', 'same words'))
    expect(() => applyMarkdownOperations(twice, [{ type: 'replace_text', find: 'same', replace: 'x' }], direct)).toThrow(/First.*Second/)
    expect(() => applyMarkdownOperations(sections(), [{ type: 'replace_text', find: 'push  to MAIN.', replace: 'x' }], direct)).toThrow(/spacing or capitals/)
  })

  it('refuses a missing heading or empty text with a message that says what to send', () => {
    expect(() => applyMarkdownOperations(sections(), [{ type: 'replace_section', heading: 'Nope', text: 'x' }], direct)).toThrow(/no heading "Nope"/)
    expect(() => applyMarkdownOperations(sections(), [{ type: 'append', text: '  ' }], direct)).toThrow(/append needs text/)
  })
})

describe('range edits', () => {
  const flat = () =>
    doc(
      paragraph('t', 'Lapis Sekarang Setelah'),
      paragraph('a', 'Traefik (ingress) 1 tujuan'),
      paragraph('b', 'Interceptor connectx dipasang di 1 binary'),
      paragraph('c', 'Jadi fungsi gateway tidak hilang.')
    )
  const direct = { mode: 'direct', author: ME, newID: ids } as const

  it('turns plain paragraphs into a heading and a code block', () => {
    const { json } = applyMarkdownOperations(
      flat(),
      [{ type: 'replace_range', from: 'Traefik (ingress)', to: 'dipasang di 1 binary', text: '## Perbandingan layer\n\n```text\nTraefik   1 tujuan\nInterceptor   1 binary\n```' }],
      direct
    )
    const markdown = toMarkdown(json)
    expect(markdown).toContain('## Perbandingan layer')
    expect(markdown).toContain('```text\nTraefik   1 tujuan\nInterceptor   1 binary\n```')
    expect(markdown).toContain('Lapis Sekarang Setelah')
    expect(markdown).toContain('Jadi fungsi gateway tidak hilang.')
    expect(markdown).not.toContain('Traefik (ingress)')
  })

  it('replaces one block when only from is given', () => {
    const { json } = applyMarkdownOperations(flat(), [{ type: 'replace_range', from: 'Lapis Sekarang', text: '# Arsitektur' }], direct)
    expect(toMarkdown(json)).toContain('# Arsitektur')
    expect(toMarkdown(json)).not.toContain('Lapis Sekarang')
  })

  it('proposes a range replacement as suggestions that pass the suggester check', () => {
    const before = flat()
    const { json, suggestionIDs } = applyMarkdownOperations(before, [{ type: 'replace_range', from: 'Traefik', to: 'Interceptor', text: '## Layer' }], { mode: 'suggest', author: ME, newID: ids })
    expect(suggestionIDs.length).toBeGreaterThan(0)
    expect(validateSuggesterChange(before, json, ME)).toEqual({ ok: true })
  })

  it('says what is wrong when an end is missing, ambiguous or before the start', () => {
    const twice = doc(paragraph('a', 'same'), paragraph('b', 'same'))
    expect(() => applyMarkdownOperations(twice, [{ type: 'replace_range', from: 'same', text: 'x' }], direct)).toThrow(/2 blocks/)
    expect(() => applyMarkdownOperations(flat(), [{ type: 'replace_range', from: 'nowhere', text: 'x' }], direct)).toThrow(/not found/)
    expect(() => applyMarkdownOperations(flat(), [{ type: 'replace_range', from: 'Interceptor', to: 'Traefik', text: 'x' }], direct)).toThrow(/to "Traefik" was not found in one block at or after the block that holds from/)
    expect(() => applyMarkdownOperations(flat(), [{ type: 'replace_range', from: 'Traefik', text: '' }], direct)).toThrow(/needs text/)
  })
})

describe('blocks that a suggestion only proposes', () => {
  const flat = () => doc(paragraph('a', 'Traefik (ingress) 1 tujuan'), paragraph('b', 'Jadi fungsi gateway tidak hilang.'))
  const suggest = { mode: 'suggest', author: ME, newID: ids } as const

  it('are not read as part of the document, so the old lines are found once', () => {
    const { json } = applyMarkdownOperations(flat(), [{ type: 'replace_range', from: 'Traefik', text: '```text\nTraefik (ingress) 1 tujuan\n```' }], suggest)
    expect(toMarkdown(json)).toBe('Traefik (ingress) 1 tujuan\n\nJadi fungsi gateway tidak hilang.\n')
    // The proposed code block holds the same line; it must not make the range ambiguous.
    const again = applyMarkdownOperations(json, [{ type: 'replace_range', from: 'Jadi fungsi', to: 'tidak hilang.', text: '## Penutup' }], suggest)
    expect(again.suggestionIDs.length).toBeGreaterThan(0)
    expect(() => applyMarkdownOperations(json, [{ type: 'replace_text', find: 'Traefik (ingress)', replace: 'x' }], suggest)).not.toThrow()
  })
})

describe('replace_text with Markdown syntax', () => {
  it('tells the Agent that a list number or heading mark is not part of the text', () => {
    const list = doc(paragraph('a', 'Kontrak: proto/nice/options.proto'))
    expect(() => applyMarkdownOperations(list, [{ type: 'replace_text', find: '1. Kontrak: proto/nice/options.proto', replace: 'x' }], { mode: 'direct', author: ME, newID: ids })).toThrow(
      /use "Kontrak: proto\/nice\/options.proto" without it/
    )
  })
})

describe('range edits that are copied loosely', () => {
  const lines = () =>
    doc(
      paragraph('a', 'Traefik   (ingress)  1 tujuan'),
      paragraph('b', 'Interceptor connectx'),
      paragraph('c', 'Penutup'),
      paragraph('d', 'Interceptor connectx')
    )
  const direct = { mode: 'direct', author: ME, newID: ids } as const

  it('starts at the first line and ends at the last line of what was copied, whatever the spacing', () => {
    const { json } = applyMarkdownOperations(lines(), [{ type: 'replace_range', from: '1. traefik (ingress)\nInterceptor connectx', to: 'Interceptor connectx\nPenutup', text: '## Ganti' }], direct)
    expect(toMarkdown(json)).toBe('## Ganti\n\nInterceptor connectx\n')
  })

  it('can start and end at the lines of a list', () => {
    const item = (id: string, value: string) => ({ type: 'list_item', attrs: { nodeID: id, bodyAttributes: '{}', bodyContent: '' }, content: [paragraph(`${id}-p`, value)] })
    const list = (id: string, ...items: J[]) => ({ type: 'order_list', attrs: { nodeID: id, bodyAttributes: '{"start":1}', bodyContent: '' }, content: items })
    const withList = doc(paragraph('t', 'Judul'), list('l1', item('i1', 'Kontrak: proto/options.proto')), list('l2', item('i2', 'Domain: role_binding.go')), paragraph('e', 'Akhir'))
    const { json } = applyMarkdownOperations(withList, [{ type: 'replace_range', from: '1. Kontrak: proto/options.proto', to: 'Domain: role_binding.go', text: '## Bagian 1' }], direct)
    expect(toMarkdown(json)).toBe('Judul\n\n## Bagian 1\n\nAkhir\n')
  })

  it('ends at the first block after the start that holds the end, even when the same line comes again later', () => {
    const { json } = applyMarkdownOperations(lines(), [{ type: 'replace_range', from: 'Traefik', to: 'Interceptor connectx', text: '## Ganti' }], direct)
    expect(toMarkdown(json)).toBe('## Ganti\n\nPenutup\n\nInterceptor connectx\n')
  })
})
