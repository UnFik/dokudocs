import { describe, expect, it } from 'vitest'
import {
  baseOffsetForDraft,
  deleteDraftBackward,
  deleteDraftForward,
  deleteDraftRange,
  diffText,
  draftOffsetForBase,
  draftSuggestion,
  insertDraftText,
  textLayerEntries,
  touchesChange,
  type TypingDraft,
} from './suggestion-draft'

function draft(
  runs: [string, string][],
  caret: { nodeID: string; offset: number }
): TypingDraft {
  return {
    suggestionID: 's1',
    blockID: 'p0',
    runs: runs.map(([nodeID, text]) => ({ nodeID, base: text, text })),
    caret,
    replaces: [],
  }
}

describe('diffText', () => {
  it('keeps the shared text around one change', () => {
    expect(diffText('hello world', 'hello brave world')).toEqual([
      { kind: 'keep', text: 'hello ' },
      { kind: 'insert', text: 'brave ' },
      { kind: 'keep', text: 'world' },
    ])
  })

  it('shows a replacement as struck text followed by the new text', () => {
    expect(diffText('a cat sat', 'a dog sat')).toEqual([
      { kind: 'keep', text: 'a ' },
      { kind: 'delete', text: 'cat' },
      { kind: 'insert', text: 'dog' },
      { kind: 'keep', text: ' sat' },
    ])
  })

  it('separates two changes in one run', () => {
    expect(diffText('one two three', 'One two three!')).toEqual([
      { kind: 'delete', text: 'o' },
      { kind: 'insert', text: 'O' },
      { kind: 'keep', text: 'ne two three' },
      { kind: 'insert', text: '!' },
    ])
  })
})

describe('caret mapping', () => {
  it('puts a caret at an insertion point after the inserted text', () => {
    expect(draftOffsetForBase('ab', 'aXYb', 1)).toBe(3)
    expect(baseOffsetForDraft('ab', 'aXYb', 3)).toBe(1)
  })

  it('puts a caret before struck text', () => {
    expect(baseOffsetForDraft('abc', 'ab', 2)).toBe(2)
    expect(draftOffsetForBase('abc', 'ab', 2)).toBe(2)
  })
})

describe('typing a draft', () => {
  it('collects consecutive keystrokes into one suggestion', () => {
    let current = draft([['r0', 'hello']], { nodeID: 'r0', offset: 5 })
    for (const key of ' world') current = insertDraftText(current, key)
    expect(draftSuggestion(current)).toEqual({
      operations: [
        {
          op: 'replace_text',
          nodeID: 'r0',
          content: 'hello world',
          baseContent: 'hello',
        },
      ],
      summary: 'Insert “ world”',
    })
  })

  it('turns delete then type into one replace', () => {
    let current = draft([['r0', 'a cat']], { nodeID: 'r0', offset: 5 })
    for (let i = 0; i < 3; i++) current = deleteDraftBackward(current)!
    current = insertDraftText(current, 'dog')
    expect(draftSuggestion(current)?.summary).toBe('Replace “cat” with “dog”')
  })

  it('removes a typed insertion completely when it is deleted again', () => {
    let current = draft([['r0', 'hi']], { nodeID: 'r0', offset: 2 })
    current = insertDraftText(current, '!!')
    current = deleteDraftBackward(deleteDraftBackward(current)!)!
    expect(draftSuggestion(current)).toBeNull()
  })

  it('backspaces across a run boundary within the block', () => {
    let current = draft(
      [
        ['r0', 'bold'],
        ['r1', ' plain'],
      ],
      { nodeID: 'r1', offset: 0 }
    )
    current = deleteDraftBackward(current)!
    expect(current.runs.map((run) => run.text)).toEqual(['bol', ' plain'])
    expect(current.caret).toEqual({ nodeID: 'r0', offset: 3 })
  })

  it('stops at the start and end of the block', () => {
    const start = draft([['r0', 'x']], { nodeID: 'r0', offset: 0 })
    expect(deleteDraftBackward(start)).toBeNull()
    const end = draft([['r0', 'x']], { nodeID: 'r0', offset: 1 })
    expect(deleteDraftForward(end)).toBeNull()
  })

  it('deletes a surrogate pair as one character', () => {
    const current = draft([['r0', 'a😀']], { nodeID: 'r0', offset: 3 })
    expect(deleteDraftBackward(current)!.runs[0]!.text).toBe('a')
  })

  it('deletes a range across runs and emits a run deletion for an emptied run', () => {
    const current = deleteDraftRange(
      draft(
        [
          ['r0', 'keep '],
          ['r1', 'gone'],
          ['r2', ' tail'],
        ],
        { nodeID: 'r0', offset: 0 }
      ),
      { nodeID: 'r0', offset: 4 },
      { nodeID: 'r2', offset: 1 }
    )
    expect(draftSuggestion(current)?.operations).toEqual([
      {
        op: 'replace_text',
        nodeID: 'r0',
        content: 'keep',
        baseContent: 'keep ',
      },
      { op: 'delete', nodeID: 'r1', baseContent: 'gone' },
      {
        op: 'replace_text',
        nodeID: 'r2',
        content: 'tail',
        baseContent: ' tail',
      },
    ])
  })
})

describe('textLayerEntries', () => {
  const suggestion = (
    suggestionId: string,
    proposerId: string,
    operations: unknown,
    status = 'pending'
  ) => ({ suggestionId, proposerId, status, operations })

  it('lists pending typed suggestions per run and marks the viewer’s own', () => {
    expect(
      textLayerEntries(
        [
          suggestion('a', 'me', [
            {
              op: 'replace_text',
              nodeID: 'r0',
              content: 'x!',
              baseContent: 'x',
            },
            { op: 'delete', nodeID: 'r1', baseContent: 'y' },
          ]),
          suggestion('b', 'other', [
            {
              op: 'replace_text',
              nodeID: 'r2',
              content: 'z!',
              baseContent: 'z',
            },
          ]),
        ],
        'me'
      )
    ).toEqual([
      { suggestionID: 'a', nodeID: 'r0', base: 'x', text: 'x!', own: true },
      { suggestionID: 'a', nodeID: 'r1', base: 'y', text: '', own: true },
      { suggestionID: 'b', nodeID: 'r2', base: 'z', text: 'z!', own: false },
    ])
  })

  it('skips decided suggestions and ones that were not typed against run text', () => {
    expect(
      textLayerEntries(
        [
          suggestion(
            'a',
            'me',
            [
              {
                op: 'replace_text',
                nodeID: 'r0',
                content: 'x',
                baseContent: 'y',
              },
            ],
            'accepted'
          ),
          suggestion('b', 'me', [
            { op: 'replace_text', nodeID: 'r0', content: 'x' },
          ]),
          suggestion('c', 'me', [
            {
              op: 'replace_text',
              nodeID: 'r0',
              content: 'x',
              baseContent: 'y',
            },
            { op: 'move', nodeID: 'p0', targetParentID: 'root' },
          ]),
        ],
        'me'
      )
    ).toEqual([])
  })
})

describe('touchesChange', () => {
  it('is true at either edge of a change and false away from it', () => {
    expect(touchesChange('hello', 'hello!', 5)).toBe(true)
    expect(touchesChange('a cat', 'a dog', 2)).toBe(true)
    expect(touchesChange('a cat', 'a dog', 5)).toBe(true)
    expect(touchesChange('Ahello', 'AAhello', 6)).toBe(false)
  })
})
