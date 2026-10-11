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
