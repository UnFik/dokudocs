import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AgentEditError, applyMarkdownOperations, blocksOf, textVersion } from '../src/agent-edit'
import { toMarkdown } from '../src/markdown'
import { validateSuggesterChange } from '../src/suggestion-validator'

type J = Record<string, any>
const ME = '00000000-0000-4000-8000-0000000000a1'
const text = (value: string) => ({ type: 'text', text: value })
const run = (id: string, ...parts: J[]) => ({ type: 'run', attrs: { nodeID: id, bodyAttributes: '{}', bodyContent: '' }, content: parts })
const block = (type: string, id: string, attributes: J, ...children: J[]) => ({
  type,
  attrs: { nodeID: id, bodyAttributes: JSON.stringify(attributes), bodyContent: '' },
  content: children,
})
const paragraph = (id: string, value: string) => block('paragraph', id, {}, run(`${id}-r`, text(value)))
const heading = (id: string, value: string, level = 2) => block('atx_heading', id, { level }, run(`${id}-r`, text(value)))
const code = (id: string, lang: string, value: string) => block('code_block', id, { type: 'fenced', lang }, ...(value ? [text(value)] : []))
const doc = (...blocks: J[]) => ({
  type: 'doc',
  content: [{ type: 'document', attrs: { nodeID: 'root', bodyAttributes: '{}', bodyContent: '' }, content: blocks }],
})
const blocksOfDoc = (json: J): J[] => json.content[0].content
const attrsOf = (node: J): J => JSON.parse(node.attrs.bodyAttributes)
const plainOf = (node: J): string => (node.type === 'text' ? node.text : (node.content ?? []).map(plainOf).join(''))

let counter = 0
const ids = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
const direct = { mode: 'direct', author: ME, newID: ids } as const
const suggest = { mode: 'suggest', author: ME, newID: ids } as const

const JSON_BODY = '{\n  "a": 1,\n\n  "b": [1, 2]\n}'
const fenced = (lang: string, body: string) => `Example:\n\n\`\`\`${lang}\n${body}\n\`\`\``
const base = () =>
  doc(heading('h1', 'Overview', 1), paragraph('p1', 'The API runs on one server.'), heading('h2', 'Deploy'), paragraph('p2', 'Push to main.'))

describe('the shared block cases', () => {
  // The same file runs against create_document in the backend (markdown_test.go).
  const cases = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../backend/internal/application/agent/testdata/markdown_blocks.json', import.meta.url)), 'utf8')
  ) as { name: string; input: string; blocks: { type: string; lang: string; text: string }[] }[]

  it('has cases', () => expect(cases.length).toBeGreaterThan(10))
  for (const c of cases)
    it(c.name, () => {
      const got = blocksOf(c.input).map((item) => ({ type: item.type, lang: item.type === 'code_block' ? item.lang : '', text: item.text }))
      expect(got).toEqual(c.blocks.map((b) => ({ type: b.type, lang: b.type === 'code_block' ? b.lang : '', text: b.text })))
    })
})

describe('writing code blocks', () => {
  it('appends a code block with its text directly in the block, not in a run', () => {
    const { json } = applyMarkdownOperations(base(), [{ type: 'append', text: fenced('json', JSON_BODY) }], direct)
    const added = blocksOfDoc(json).slice(4)
    expect(added.map((b) => b.type)).toEqual(['paragraph', 'code_block'])
    expect(attrsOf(added[1]!)).toEqual({ type: 'fenced', lang: 'json' })
    expect(added[1]!.content).toEqual([{ type: 'text', text: JSON_BODY }])
    expect(added[1]!.attrs.nodeID).toMatch(/^00000000-/)
  })

  it('reads back as the same fence', () => {
    const { json } = applyMarkdownOperations(base(), [{ type: 'append', text: fenced('json', JSON_BODY) }], direct)
    expect(toMarkdown(json)).toContain(`\`\`\`json\n${JSON_BODY}\n\`\`\``)
  })

  it('works in every operation that adds text', () => {
    const sections = () => doc(heading('h1', 'Overview', 1), paragraph('p1', 'One.'), heading('h2', 'Deploy'), paragraph('p2', 'Two.'))
    const fence = '```sh\nmake build\n```'
    const kinds = (json: J) => blocksOfDoc(json).map((b) => b.type)
    expect(kinds(applyMarkdownOperations(sections(), [{ type: 'insert_after_heading', heading: 'Deploy', text: fence }], direct).json)).toEqual([
      'atx_heading', 'paragraph', 'atx_heading', 'code_block', 'paragraph',
    ])
    expect(kinds(applyMarkdownOperations(sections(), [{ type: 'insert_before_heading', heading: 'Deploy', text: fence }], direct).json)).toEqual([
      'atx_heading', 'paragraph', 'code_block', 'atx_heading', 'paragraph',
    ])
    expect(kinds(applyMarkdownOperations(sections(), [{ type: 'append_section', heading: 'Run', text: fence }], direct).json)).toEqual([
      'atx_heading', 'paragraph', 'atx_heading', 'paragraph', 'atx_heading', 'code_block',
    ])
    expect(kinds(applyMarkdownOperations(sections(), [{ type: 'replace_section', heading: 'Deploy', text: fence }], direct).json)).toEqual([
      'atx_heading', 'paragraph', 'atx_heading', 'code_block',
    ])
  })

  it('keeps a blank line inside the code from splitting it', () => {
    const { json } = applyMarkdownOperations(base(), [{ type: 'append', text: fenced('json', JSON_BODY) }], direct)
    expect(blocksOfDoc(json).filter((b) => b.type === 'code_block')).toHaveLength(1)
  })

  it('changes the version the Agent reads', () => {
    const { json } = applyMarkdownOperations(base(), [{ type: 'append', text: fenced('json', JSON_BODY) }], direct)
    expect(textVersion(toMarkdown(json))).not.toBe(textVersion(toMarkdown(base())))
  })

  it('proposes a code block as a block insertion that passes the suggester check', () => {
    const before = base()
    const { json, suggestionIDs } = applyMarkdownOperations(before, [{ type: 'append', text: fenced('json', JSON_BODY) }], suggest)
    expect(suggestionIDs.length).toBeGreaterThanOrEqual(1)
    const added = blocksOfDoc(json).find((b) => b.type === 'code_block')!
    expect(attrsOf(added).suggestion).toMatchObject({ kind: 'insert', author: ME })
    expect(attrsOf(added)).toMatchObject({ type: 'fenced', lang: 'json' })
    expect(validateSuggesterChange(before, json, ME)).toEqual({ ok: true })
  })
})

describe('changing code inside a code block', () => {
  const withCode = () => doc(heading('h1', 'Auth', 1), paragraph('p1', 'Send this body.'), code('c1', 'json', JSON_BODY), paragraph('p2', 'Then wait.'))

  it('replaces text inside the code block and leaves the rest alone', () => {
    const before = withCode()
    const { json } = applyMarkdownOperations(before, [{ type: 'replace_text', find: '"a": 1', replace: '"a": 2' }], direct)
    const changed = blocksOfDoc(json)
    expect(plainOf(changed[2]!)).toBe(JSON_BODY.replace('"a": 1', '"a": 2'))
    expect(changed[2]!.type).toBe('code_block')
    expect(attrsOf(changed[2]!)).toEqual({ type: 'fenced', lang: 'json' })
    expect(changed.map((b) => b.type)).toEqual(['atx_heading', 'paragraph', 'code_block', 'paragraph'])
    expect(textVersion(toMarkdown(json))).not.toBe(textVersion(toMarkdown(before)))
  })

  it('replaces text that spans lines, as read_document shows it', () => {
    const { json } = applyMarkdownOperations(withCode(), [{ type: 'replace_text', find: '1,\n\n  "b"', replace: '1,\n  "c"' }], direct)
    expect(plainOf(blocksOfDoc(json)[2]!)).toBe('{\n  "a": 1,\n  "c": [1, 2]\n}')
  })

  it('can empty a code block', () => {
    const { json } = applyMarkdownOperations(doc(code('c1', 'sh', 'ls')), [{ type: 'replace_text', find: 'ls', replace: '' }], direct)
    expect(plainOf(blocksOfDoc(json)[0]!)).toBe('')
  })

  it('refuses text that appears in the code and elsewhere', () => {
    const both = doc(paragraph('p1', 'The "a": 1 field.'), code('c1', 'json', JSON_BODY))
    expect(() => applyMarkdownOperations(both, [{ type: 'replace_text', find: '"a": 1', replace: 'x' }], direct)).toThrow(/appears 2 times/)
  })

  it('refuses text that is not in the code', () => {
    expect(() => applyMarkdownOperations(withCode(), [{ type: 'replace_text', find: '"zzz"', replace: 'x' }], direct)).toThrow(AgentEditError)
  })

  it('proposes the change as a deleted block and a new block, which passes the suggester check', () => {
    const before = withCode()
    const { json, suggestionIDs } = applyMarkdownOperations(before, [{ type: 'replace_text', find: '"a": 1', replace: '"a": 2' }], suggest)
    expect(suggestionIDs.length).toBeGreaterThanOrEqual(2)
    const blocks = blocksOfDoc(json)
    const codes = blocks.filter((b) => b.type === 'code_block')
    expect(codes).toHaveLength(2)
    expect(attrsOf(codes[0]!).suggestion).toMatchObject({ kind: 'delete', author: ME })
    expect(plainOf(codes[0]!)).toBe(JSON_BODY)
    expect(attrsOf(codes[1]!).suggestion).toMatchObject({ kind: 'insert', author: ME })
    expect(plainOf(codes[1]!)).toBe(JSON_BODY.replace('"a": 1', '"a": 2'))
    expect(blocks.indexOf(codes[1]!)).toBe(blocks.indexOf(codes[0]!) + 1)
    expect(validateSuggesterChange(before, json, ME)).toEqual({ ok: true })
  })
})
