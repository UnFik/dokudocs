import { describe, expect, it } from 'vitest'
import { addSelection, selectionAttachment } from './selection-context'

const page = '# Title\n\nHello **world** here\n\n- item one\n- item two\n'

describe('selectionAttachment', () => {
  it('names a one-line selection by its words and its line', () => {
    expect(selectionAttachment(page, 'Hello world here')).toEqual({
      name: 'Hello world here · L3',
      text: 'Hello world here',
    })
  })

  it('spans the lines from the first block to the last', () => {
    expect(selectionAttachment(page, 'item one\nitem two')).toEqual({
      name: 'item one item two · L5–6',
      text: 'item one\nitem two',
    })
  })

  it('leaves the line out when the words sit on more than one line', () => {
    const twice = 'same words\n\nsame words\n'
    expect(selectionAttachment(twice, 'same words').name).toBe('same words')
  })

  it('cuts a long selection short in its name but not in its text', () => {
    const long = 'a'.repeat(30) + ' ' + 'b'.repeat(30)
    const made = selectionAttachment('', long)
    expect(made.name).toBe(`${'a'.repeat(30)} ${'b'.repeat(9)}…`)
    expect(made.text).toBe(long)
  })
})

describe('addSelection', () => {
  const made = (text: string, name = text) => ({ name, text })

  it('adds a selection after the ones already attached', () => {
    expect(addSelection([made('a')], made('b'))).toEqual({
      attachments: [made('a'), made('b')],
    })
  })

  it('ignores the same text added twice', () => {
    const have = [made('a', 'a · L1')]
    expect(addSelection(have, made('a', 'a · L9'))).toEqual({
      attachments: have,
    })
  })

  it('tells two different texts with one name apart', () => {
    const result = addSelection([made('x1', 'x')], made('x2', 'x'))
    expect(result.attachments.map((a) => a.name)).toEqual(['x', 'x (2)'])
  })

  it('stops at five attachments and says so', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((t) => made(t))
    const result = addSelection(five, made('f'))
    expect(result.attachments).toEqual(five)
    expect(result.error).toBe('Attach up to 5 files to one question.')
  })

  it('stops when the text together passes the limit', () => {
    const big = made('x'.repeat(200_000), 'big')
    const result = addSelection([big], made('y'))
    expect(result.attachments).toEqual([big])
    expect(result.error).toBe(
      'That selection is too long. All the files together may hold up to 200,000 characters.'
    )
  })
})
