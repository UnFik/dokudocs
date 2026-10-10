import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSourceAnchor, resolveSourceAnchor } from './source-comments'

function shared(source: string) {
  const doc = new Y.Doc()
  const text = doc.getText('source')
  text.insert(0, source)
  return { doc, text }
}

describe('source comment anchors', () => {
  it('points at the words and gives them back', () => {
    const { doc, text } = shared('Table users {\n  id int\n}')
    const anchor = createSourceAnchor(text, 6, 11)!
    expect(anchor).toMatchObject({ kind: 'source' })
    expect(resolveSourceAnchor(doc, text, anchor)).toEqual({ from: 6, to: 11 })
  })

  it('follows the words when text is added before them', () => {
    const { doc, text } = shared('hello world')
    const anchor = createSourceAnchor(text, 6, 11)!
    text.insert(0, 'oh, ')
    expect(resolveSourceAnchor(doc, text, anchor)).toEqual({ from: 10, to: 15 })
  })

  it('stays put when text is added after them', () => {
    const { doc, text } = shared('hello world')
    const anchor = createSourceAnchor(text, 0, 5)!
    text.insert(11, '!!!')
    expect(resolveSourceAnchor(doc, text, anchor)).toEqual({ from: 0, to: 5 })
  })

  it('grows when words are typed inside them, not when typed against an edge', () => {
    const { doc, text } = shared('hello world')
    const anchor = createSourceAnchor(text, 0, 5)!
    text.insert(2, 'XX')
    expect(resolveSourceAnchor(doc, text, anchor)).toEqual({ from: 0, to: 7 })
    text.insert(7, '++')
    expect(resolveSourceAnchor(doc, text, anchor)).toEqual({ from: 0, to: 7 })
    text.insert(0, '--')
    expect(resolveSourceAnchor(doc, text, anchor)).toEqual({ from: 2, to: 9 })
  })

  it('is gone once its words are deleted', () => {
    const { doc, text } = shared('hello world')
    const anchor = createSourceAnchor(text, 6, 11)!
    text.delete(5, 6)
    expect(resolveSourceAnchor(doc, text, anchor)).toBeNull()
  })

  it('survives a trip through the server as text', () => {
    const { text } = shared('hello world')
    const anchor = createSourceAnchor(text, 6, 11)!
    const copy = new Y.Doc()
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(text.doc!))
    const sent = JSON.parse(JSON.stringify(anchor))
    expect(resolveSourceAnchor(copy, copy.getText('source'), sent)).toEqual({
      from: 6,
      to: 11,
    })
  })

  it('refuses an empty selection and a anchor that is not valid', () => {
    const { doc, text } = shared('hello')
    expect(createSourceAnchor(text, 2, 2)).toBeNull()
    expect(
      resolveSourceAnchor(doc, text, { kind: 'source', start: '!!', end: '??' })
    ).toBeNull()
  })
})
