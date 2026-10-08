import { describe, expect, it } from 'vitest'
import { validateSuggesterChange } from '../src/suggestion-validator'

type J = Record<string, unknown>
const ME = '00000000-0000-4000-8000-0000000000a1'
const OTHER = '00000000-0000-4000-8000-0000000000a2'
const ID = '00000000-0000-4000-8000-0000000000b1'

const text = (value: string, marks: J[] = []) => ({ type: 'text', text: value, ...(marks.length ? { marks } : {}) })
const run = (id: string, ...parts: J[]) => ({ type: 'run', attrs: { nodeID: id, bodyAttributes: '{}', bodyContent: '' }, content: parts })
const paragraph = (id: string, ...runs: J[]) => ({ type: 'paragraph', attrs: { nodeID: id, bodyAttributes: '{}', bodyContent: '' }, content: runs })
const doc = (...blocks: J[]) => ({
  type: 'doc',
  content: [{ type: 'document', attrs: { nodeID: 'root', bodyAttributes: '{}', bodyContent: '' }, content: blocks }],
})
const insertMark = (author = ME, id = ID) => ({ type: 'suggestion_insert', attrs: { id, author } })
const deleteMark = (author = ME, id = ID) => ({ type: 'suggestion_delete', attrs: { id, author } })

const base = () => doc(paragraph('p', run('r', text('hello'))))

// What someone who may only suggest is allowed to write: marks they own, and
// nothing that changes the canonical text.
describe('a suggester’s change', () => {
  it('may add text marked as their own insertion', () => {
    const after = doc(paragraph('p', run('r', text('hello'), text(' world', [insertMark()]))))
    expect(validateSuggesterChange(base(), after, ME)).toEqual({ ok: true })
  })

  it('may mark text for deletion without removing it', () => {
    const after = doc(paragraph('p', run('r', text('hel'), text('lo', [deleteMark()]))))
    expect(validateSuggesterChange(base(), after, ME)).toEqual({ ok: true })
  })

  it('may not change canonical text', () => {
    const after = doc(paragraph('p', run('r', text('hello!'))))
    expect(validateSuggesterChange(base(), after, ME)).toMatchObject({ ok: false })
  })

  it('may not remove canonical text', () => {
    const after = doc(paragraph('p', run('r', text('hel'))))
    expect(validateSuggesterChange(base(), after, ME)).toMatchObject({ ok: false })
  })

  it('may not write a suggestion in someone else’s name', () => {
    const after = doc(paragraph('p', run('r', text('hello'), text(' x', [insertMark(OTHER)]))))
    expect(validateSuggesterChange(base(), after, ME)).toMatchObject({ ok: false })
  })

  it('may not touch another person’s suggestion', () => {
    const before = doc(paragraph('p', run('r', text('hello'), text(' theirs', [insertMark(OTHER)]))))
    const after = doc(paragraph('p', run('r', text('hello'))))
    expect(validateSuggesterChange(before, after, ME)).toMatchObject({ ok: false })
  })

  it('may remove their own insertion again', () => {
    const before = doc(paragraph('p', run('r', text('hello'), text(' mine', [insertMark()]))))
    expect(validateSuggesterChange(before, base(), ME)).toEqual({ ok: true })
  })

  it('may add a whole new paragraph as an insertion', () => {
    const inserted = {
      type: 'paragraph',
      attrs: { nodeID: 'new', bodyAttributes: JSON.stringify({ suggestion: { kind: 'insert', id: ID, author: ME } }), bodyContent: '' },
      content: [run('r2', text('added', [insertMark()]))],
    }
    expect(validateSuggesterChange(base(), doc(paragraph('p', run('r', text('hello'))), inserted), ME)).toEqual({ ok: true })
  })

  it('refuses a mark with keys it does not know', () => {
    const odd = { type: 'suggestion_insert', attrs: { id: ID, author: ME, extra: 1 } }
    const after = doc(paragraph('p', run('r', text('hello'), text(' x', [odd]))))
    expect(validateSuggesterChange(base(), after, ME)).toMatchObject({ ok: false })
  })
})

describe('a suggester typing inside a run', () => {
  it('may split the run in two', () => {
    const after = doc(paragraph('p', run('r', text('hel')), run('r2', text('lo'), text(' x', [insertMark()]))))
    expect(validateSuggesterChange(base(), after, ME)).toEqual({ ok: true })
  })
})

describe('a suggester proposing underline or highlight', () => {
  it('may propose them as a format suggestion', () => {
    for (const key of ['underline', 'highlight']) {
      const mark = { type: 'suggestion_format', attrs: { id: ID, author: ME, set: { [key]: true } } }
      const after = doc(paragraph('p', run('r', text('hello', [mark]))))
      expect(validateSuggesterChange(base(), after, ME)).toEqual({ ok: true })
    }
  })
})
