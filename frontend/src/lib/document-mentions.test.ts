import { describe, expect, it } from 'vitest'
import {
  activeMentionQuery,
  deserialize,
  messageParts,
  parseDocumentMentions,
  serialize,
  trackEdit,
  visibleText,
} from './document-mentions'
import fixture from './document-mentions.fixture.json'

const id = '11111111-1111-4111-8111-111111111111'

describe('the grammar shared with the backend', () => {
  for (const tc of fixture.cases) {
    it(tc.name, () => {
      expect(parseDocumentMentions(tc.content)).toEqual(tc.mentions)
      expect(visibleText(tc.content)).toBe(tc.visible)
    })
  }
})

describe('a text box', () => {
  it('shows a stored question as @Title and turns it back into the token', () => {
    const stored = `compare @[Runbook](doc:${id}) with the guide`
    const { text, mentions } = deserialize(stored)
    expect(text).toBe('compare @Runbook with the guide')
    expect(mentions).toEqual([
      { documentID: id, label: 'Runbook', start: 8, end: 16 },
    ])
    expect(serialize(text, mentions)).toBe(stored)
  })

  it('moves a mention along when text is typed before it', () => {
    const { text, mentions } = deserialize(`@[Runbook](doc:${id})`)
    const moved = trackEdit(mentions, text, `see ${text}`)
    expect(moved[0]).toMatchObject({ start: 4, end: 12 })
  })

  it('leaves a mention as plain text once its name is edited', () => {
    const { text, mentions } = deserialize(`@[Runbook](doc:${id}) now`)
    const edited = '@Runbok now'
    const kept = trackEdit(mentions, text, edited)
    expect(kept).toEqual([])
    expect(serialize(edited, kept)).toBe('@Runbok now')
  })

  it('opens the list for an @ that starts a word and not for an email', () => {
    expect(activeMentionQuery('ask @run', 8)).toEqual({
      start: 4,
      query: 'run',
    })
    expect(activeMentionQuery('mail me@example', 15)).toBeNull()
    expect(activeMentionQuery('@a\nb', 4)).toBeNull()
  })
})

describe('messageParts', () => {
  it('splits a question into text and document chips in order', () => {
    expect(messageParts(`read @[Runbook](doc:${id}) now`)).toEqual([
      { kind: 'text', text: 'read ' },
      { kind: 'document', documentID: id, label: 'Runbook' },
      { kind: 'text', text: ' now' },
    ])
  })
})
