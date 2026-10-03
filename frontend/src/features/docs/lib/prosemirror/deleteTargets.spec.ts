import { describe, expect, it } from 'vitest'
import { withEmptiedParents } from './deleteTargets'
import { documentBodySchema } from './documentBody'
import { documentOf, paragraph, run, stateOf } from './suggestionTestKit'

const nodes = documentBodySchema.nodes
const idAttrs = (nodeID: string) => ({
  nodeID,
  bodyAttributes: '{}',
  bodyContent: '',
})

function list(...items: string[]) {
  return nodes.bullet_list!.create(
    idAttrs('list'),
    items.map((text) =>
      nodes.list_item!.create(idAttrs(`item-${text}`), [
        paragraph(`para-${text}`, [run(`run-${text}`, [text])]),
      ])
    )
  )
}

describe('withEmptiedParents', () => {
  it('deletes the list item when its only paragraph is deleted', () => {
    const { doc } = stateOf(documentOf(list('one', 'two', 'three')))
    expect(withEmptiedParents(doc, ['para-two'])).toEqual(['item-two'])
  })

  it('deletes the whole list when every item goes', () => {
    const { doc } = stateOf(documentOf(list('one', 'two')))
    expect(withEmptiedParents(doc, ['para-one', 'para-two'])).toEqual(['list'])
  })

  it('leaves a paragraph in a document, a quote or a run alone', () => {
    const { doc } = stateOf(
      documentOf(
        paragraph('p1', [run('r1', ['a'])]),
        paragraph('p2', [run('r2', ['b'])])
      )
    )
    expect(withEmptiedParents(doc, ['p1'])).toEqual(['p1'])
    expect(withEmptiedParents(doc, ['r1'])).toEqual(['r1'])
  })

  it('keeps an item that still has another block', () => {
    const item = nodes.list_item!.create(idAttrs('item'), [
      paragraph('a', [run('ra', ['a'])]),
      paragraph('b', [run('rb', ['b'])]),
    ])
    const { doc } = stateOf(
      documentOf(nodes.bullet_list!.create(idAttrs('list'), [item]))
    )
    expect(withEmptiedParents(doc, ['a'])).toEqual(['a'])
    expect(withEmptiedParents(doc, ['a', 'b'])).toEqual(['list'])
  })
})
