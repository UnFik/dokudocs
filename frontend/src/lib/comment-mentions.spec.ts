import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/comment-mentions.json'
import {
  activeMentionQuery,
  deserialize,
  mentionToken,
  parseMentions,
  serialize,
  trackEdit,
  visibleText,
} from './comment-mentions'

const ANA = '11111111-1111-4111-8111-111111111111'
const BO = '22222222-2222-4222-8222-222222222222'

// The same file drives the Go parser in the backend, so the two agree.
describe('the shared mention fixture', () => {
  it.each(fixture.cases)('$name', (testCase) => {
    expect(parseMentions(testCase.content)).toEqual(testCase.mentions)
    expect(visibleText(testCase.content)).toBe(testCase.visible)
  })
})

describe('mentionToken', () => {
  it('writes the form the backend reads', () => {
    expect(mentionToken(ANA, 'Ana Bo')).toBe(`@[Ana Bo](user:${ANA})`)
  })
})

describe('deserialize and serialize', () => {
  it('shows a mention as @Name and remembers who it is', () => {
    const content = `hi ${mentionToken(ANA, 'Ana Bo')}, and ${mentionToken(BO, 'Bo Ca')}!`
    const { text, mentions } = deserialize(content)
    expect(text).toBe('hi @Ana Bo, and @Bo Ca!')
    expect(mentions).toEqual([
      { start: 3, end: 10, userID: ANA, label: 'Ana Bo' },
      { start: 16, end: 22, userID: BO, label: 'Bo Ca' },
    ])
    expect(serialize(text, mentions)).toBe(content)
  })

  it('leaves text without a token alone', () => {
    expect(deserialize('plain @ text')).toEqual({
      text: 'plain @ text',
      mentions: [],
    })
    expect(serialize('plain @ text', [])).toBe('plain @ text')
  })

  it('drops a mention whose text no longer reads as its name', () => {
    const mentions = [{ start: 3, end: 10, userID: ANA, label: 'Ana Bo' }]
    expect(serialize('hi @Ana Bx', mentions)).toBe('hi @Ana Bx')
  })

  it('round-trips every case of the shared fixture that has mentions', () => {
    for (const testCase of fixture.cases) {
      const { text, mentions } = deserialize(testCase.content)
      expect(text).toBe(testCase.visible)
      expect(serialize(text, mentions)).toBe(
        testCase.content.replace(
          /user:([0-9A-F-]{36})/g,
          (_m, id: string) => `user:${id.toLowerCase()}`
        )
      )
    }
  })
})

describe('trackEdit', () => {
  const start = deserialize(
    `${mentionToken(ANA, 'Ana Bo')} said ${mentionToken(BO, 'Bo Ca')}`
  )

  it('moves a mention along when text is typed before it', () => {
    const typed = `oh ${start.text}`
    const next = trackEdit(start.mentions, start.text, typed)
    expect(next.map((m) => [m.start, m.end])).toEqual([
      [3, 10],
      [16, 22],
    ])
    expect(serialize(typed, next)).toBe(
      `oh ${mentionToken(ANA, 'Ana Bo')} said ${mentionToken(BO, 'Bo Ca')}`
    )
  })

  it('keeps a mention when text is typed after it', () => {
    const typed = `${start.text}!`
    expect(trackEdit(start.mentions, start.text, typed)).toEqual(start.mentions)
  })

  it('moves the later mention back when an earlier span is deleted', () => {
    const cut = start.text.replace('@Ana Bo ', '')
    const next = trackEdit(start.mentions, start.text, cut)
    expect(next).toEqual([{ start: 5, end: 11, userID: BO, label: 'Bo Ca' }])
  })

  it('turns a mention into plain text when its name is edited', () => {
    const edited = start.text.replace('@Ana Bo', '@Ana Bx')
    const next = trackEdit(start.mentions, start.text, edited)
    expect(next.map((m) => m.userID)).toEqual([BO])
    expect(serialize(edited, next)).toBe(
      `@Ana Bx said ${mentionToken(BO, 'Bo Ca')}`
    )
  })

  it('turns a mention into plain text when text is typed inside it', () => {
    const edited = start.text.replace('@Ana Bo', '@Ana, Bo')
    expect(
      trackEdit(start.mentions, start.text, edited).map((m) => m.userID)
    ).toEqual([BO])
  })

  it('does nothing when the text did not change', () => {
    expect(trackEdit(start.mentions, start.text, start.text)).toEqual(
      start.mentions
    )
  })

  it('handles a replaced selection spanning several mentions', () => {
    expect(trackEdit(start.mentions, start.text, 'gone')).toEqual([])
  })
})

describe('activeMentionQuery', () => {
  it.each([
    ['@', 1, { start: 0, query: '' }],
    ['hi @an', 6, { start: 3, query: 'an' }],
    ['hi @Ana B', 9, { start: 3, query: 'Ana B' }],
    ['line\n@bo', 8, { start: 5, query: 'bo' }],
    ['@an and more', 3, { start: 0, query: 'an' }],
  ])('finds the query in %j with the caret at %i', (text, caret, expected) => {
    expect(activeMentionQuery(text, caret)).toEqual(expected)
  })

  it.each([
    ['no at sign', 4],
    ['mail me@example', 11],
    ['hi @ there', 10],
    ['hi @an\nnext', 11],
    ['@[Ana](user:x', 5],
    ['hi @', 0],
  ])('finds none in %j with the caret at %i', (text, caret) => {
    expect(activeMentionQuery(text, caret)).toBeNull()
  })

  it('finds none at an @ that already is a mention', () => {
    const { text, mentions } = deserialize(`hi ${mentionToken(ANA, 'Ana Bo')} `)
    expect(activeMentionQuery(text, text.length)).not.toBeNull()
    expect(activeMentionQuery(text, text.length, mentions)).toBeNull()
  })

  it('finds none once the query grows past a name', () => {
    expect(activeMentionQuery(`@${'a'.repeat(60)}`, 61)).toBeNull()
  })
})
