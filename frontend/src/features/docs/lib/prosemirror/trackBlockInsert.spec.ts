import {
  TextSelection,
  type EditorState,
  type Transaction,
} from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { blockItems } from './blocks/blockMenu'
import { decideSuggestion } from './decideSuggestion'
import { documentBodySchema } from './documentBody'
import { cardTitle, suggestionCards } from './suggestionCards'
import {
  canonicalRuns,
  documentOf,
  ME,
  paragraph,
  run,
  stateOf,
} from './suggestionTestKit'
import { suggestBlockInsert } from './trackBlockInsert'

let counter = 0
const options = {
  author: ME,
  newID: () =>
    `00000000-0000-4000-8000-0000000009${String(counter++).padStart(2, '0')}`,
}

/** document > paragraph "Intro", then an empty paragraph with the caret in it. */
function blankAfterIntro() {
  const state = stateOf(
    documentOf(
      paragraph('p1', [run('r1', ['Intro'])]),
      documentBodySchema.nodes.paragraph!.create({
        nodeID: 'p2',
        bodyAttributes: '{}',
        bodyContent: '',
      })
    )
  )
  let blank = 0
  state.doc.descendants((node, pos) => {
    if (node.attrs.nodeID === 'p2') blank = pos + 1
  })
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, blank))
  )
}

function chosen(state: EditorState, id: string) {
  let built: Transaction | undefined
  blockItems
    .find((item) => item.id === id)!
    .command(state, (tr) => {
      built = tr
    })
  return suggestBlockInsert(state, built!, options)
}

const topLevel = (state: EditorState) =>
  state.doc.firstChild!.children.map((node) => node.type.name)

describe.each([
  ['bullet-list', 'bullet_list', 'Add: bulleted list'],
  ['ordered-list', 'order_list', 'Add: numbered list'],
  ['task-list', 'task_list', 'Add: task list'],
  ['quote', 'block_quote', 'Add: quote'],
  ['code-block', 'code_block', 'Add: code block'],
  ['table', 'table', 'Add: table'],
  ['divider', 'thematic_break', 'Add: divider'],
  ['math-block', 'math_block', 'Add: math block'],
  ['mermaid', 'diagram', 'Add: diagram'],
])('the %s block from the menu in Suggest mode', (id, typeName, title) => {
  it('is added after the paragraph as one suggestion the body does not see', () => {
    let state = blankAfterIntro()
    state = state.apply(chosen(state, id))

    expect(topLevel(state)).toEqual(['paragraph', 'paragraph', typeName])
    const cards = suggestionCards(state.doc)
    expect(cards.map(cardTitle)).toEqual([title])
    expect(canonicalRuns(state.doc)).toEqual(['Intro'])
  })

  it('rejecting removes it whole and accepting keeps it', () => {
    let state = blankAfterIntro()
    state = state.apply(chosen(state, id))
    const [card] = suggestionCards(state.doc)

    const rejected = state.apply(
      decideSuggestion(state, card!.id, 'reject').transaction
    )
    expect(topLevel(rejected)).toEqual(['paragraph', 'paragraph'])
    const accepted = state.apply(
      decideSuggestion(state, card!.id, 'accept').transaction
    )
    expect(topLevel(accepted)).toEqual(['paragraph', 'paragraph', typeName])
    expect(suggestionCards(accepted.doc)).toEqual([])
  })

  it('keeps the block its own attributes, before and after it is decided', () => {
    let state = blankAfterIntro()
    state = state.apply(chosen(state, id))
    const [card] = suggestionCards(state.doc)
    const attributesOf = (doc: EditorState['doc']) => {
      let found: Record<string, unknown> = {}
      doc.descendants((node) => {
        if (node.type.name === typeName)
          found = JSON.parse(String(node.attrs.bodyAttributes))
        return true
      })
      delete found.suggestion
      return found
    }
    const proposed = attributesOf(state.doc)
    const accepted = state.apply(
      decideSuggestion(state, card!.id, 'accept').transaction
    )

    expect(attributesOf(accepted.doc)).toEqual(proposed)
    if (typeName === 'code_block')
      expect(proposed).toMatchObject({ type: 'fenced' })
    if (typeName === 'bullet_list')
      expect(proposed).toMatchObject({ marker: '-' })
  })
})
