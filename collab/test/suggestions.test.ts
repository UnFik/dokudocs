import { describe, expect, it } from 'vitest'
import { suggestionsIn } from '../src/suggestions'

const mark = (type: string, id: string, author: string) => ({ type, attrs: { id, author } })
const text = (value: string, marks: object[]) => ({ type: 'text', text: value, marks })
const doc = (...texts: object[]) => ({
  type: 'doc',
  content: [{ type: 'document', content: [{ type: 'paragraph', content: [{ type: 'run', content: texts }] }] }],
})

describe('suggestions in a document', () => {
  it('lists each suggestion once, whatever kind of mark carries it', () => {
    const json = doc(
      text('a', [mark('suggestion_insert', 's1', 'u1')]),
      text('b', [mark('suggestion_insert', 's1', 'u1')]),
      text('c', [mark('suggestion_delete', 's2', 'u2')]),
      text('d', [mark('suggestion_format', 's3', 'u1'), { type: 'strong' }]),
      text('plain', []),
    )
    expect(suggestionsIn(json)).toEqual([
      { id: 's1', author: 'u1' },
      { id: 's2', author: 'u2' },
      { id: 's3', author: 'u1' },
    ])
  })

  it('is empty when nothing is suggested', () => {
    expect(suggestionsIn(doc(text('plain', [])))).toEqual([])
  })
})
