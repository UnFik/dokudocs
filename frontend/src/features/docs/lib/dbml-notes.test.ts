import { describe, expect, it } from 'vitest'
import { maskDbmlNotes, resolveNote } from './dbml-notes'

describe('maskDbmlNotes', () => {
  it('replaces a table note string with a token and keeps the text aside', () => {
    const { text, notes } = maskDbmlNotes(
      "Table posts {\n  id int\n  Note: 'Blog articles'\n}"
    )

    expect(notes).toEqual(['Blog articles'])
    expect(text).not.toContain('Blog articles')
    expect(resolveNote(notes, text)).toBe('Blog articles')
  })

  it('keeps braces, slashes and escaped quotes inside a note intact', () => {
    const { text, notes } = maskDbmlNotes(
      "Table t {\n  body text [note: 'a } b // https://x.y \\'q\\' c', not null]\n}"
    )

    expect(notes).toEqual(["a } b // https://x.y 'q' c"])
    expect(text).toBe(
      'Table t {\n  body text [note: __DBML_NOTE_0__, not null]\n}'
    )
  })

  it('turns a Note block into the single-line form without its braces', () => {
    const { text, notes } = maskDbmlNotes(
      "Table t {\n  id int\n  Note {\n    'Line 1\nLine 2'\n  }\n  name text\n}"
    )

    expect(notes).toEqual(['Line 1\nLine 2'])
    expect(text).toBe(
      'Table t {\n  id int\n  Note: __DBML_NOTE_0__\n  name text\n}'
    )
  })

  it('reads triple-quoted notes and drops their shared indentation', () => {
    const { notes } = maskDbmlNotes(
      "Table t {\n  Note: '''\n    First } line\n      indented\n  '''\n}"
    )

    expect(notes).toEqual(['First } line\n  indented'])
  })

  it('leaves notes inside comments and other strings untouched', () => {
    const source = [
      "// Note: 'commented out'",
      "/* Note: 'block comment' */",
      'Table t {',
      "  label text [default: 'a Note: \\'b\\' c']",
      '  note text',
      '}',
    ].join('\n')

    const { text, notes } = maskDbmlNotes(source)

    expect(notes).toEqual([])
    expect(text).toBe(source)
  })

  it('does not throw and changes nothing for an unterminated string', () => {
    const source = "Table t {\n  Note: 'never closed\n}"

    const { text, notes } = maskDbmlNotes(source)

    expect(notes).toEqual([])
    expect(text).toBe(source)
  })
})
