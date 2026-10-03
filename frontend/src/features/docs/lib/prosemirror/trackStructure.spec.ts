import { TextSelection, type EditorState } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { decideSuggestion } from './decideSuggestion'
import { documentBodySchema, prosemirrorToDocumentBody } from './documentBody'
import { cardTitle, suggestionCards } from './suggestionCards'
import {
  canonicalRuns,
  documentOf,
  ME,
  OTHER,
  paragraph,
  positionIn,
  run,
  stateOf,
} from './suggestionTestKit'
import { suggestReplace, UnsupportedSuggestionError } from './trackChanges'
import {
  joinTarget,
  suggestEnter,
  suggestJoin,
  suggestPasteLines,
} from './trackStructure'

let counter = 0
const options = {
  author: ME,
  newID: () =>
    `00000000-0000-4000-8000-0000000008${String(counter++).padStart(2, '0')}`,
}

function caretAt(state: EditorState, needle: string, offset: number) {
  return state.apply(
    state.tr.setSelection(
      TextSelection.create(state.doc, positionIn(state.doc, needle, offset))
    )
  )
}

const twoParagraphs = () =>
  stateOf(
    documentOf(
      paragraph('p1', [run('r1', ['first'])]),
      paragraph('p2', [run('r2', ['second'])])
    )
  )

const paragraphCount = (state: EditorState) =>
  prosemirrorToDocumentBody(state.doc).filter((row) => row.type === 'paragraph')
    .length

describe('Enter in Suggest mode', () => {
  it('adds an empty paragraph after the caret paragraph, as a suggestion the canonical body does not see', () => {
    let state = caretAt(twoParagraphs(), 'first', 5)

    state = state.apply(suggestEnter(state, options))

    expect(paragraphCount(state)).toBe(2)
    expect(canonicalRuns(state.doc)).toEqual(['first', 'second'])
    const cards = suggestionCards(state.doc)
    expect(cards.map(cardTitle)).toEqual(['Add: new paragraph'])
    expect(state.selection.$from.parent.type.name).toBe('paragraph')
    expect(state.selection.$from.parent.content.size).toBe(0)
  })

  it('puts what is typed next into the same suggestion', () => {
    let state = caretAt(twoParagraphs(), 'first', 5)
    state = state.apply(suggestEnter(state, options))

    state = state.apply(
      suggestReplace(
        state,
        state.selection.from,
        state.selection.to,
        'typed',
        options
      )
    )

    const cards = suggestionCards(state.doc)
    expect(cards.map(cardTitle)).toEqual(['Add: "typed"'])
    expect(canonicalRuns(state.doc)).toEqual(['first', 'second'])

    // Rejecting takes the paragraph and the text in it, nothing else.
    const rejected = state.apply(
      decideSuggestion(state, cards[0]!.id, 'reject').transaction
    )
    expect(rejected.doc.textContent).toBe('firstsecond')
    expect(paragraphCount(rejected)).toBe(2)
  })

  it('keeps pressing Enter in your own new paragraph in the same suggestion', () => {
    let state = caretAt(twoParagraphs(), 'first', 5)
    state = state.apply(suggestEnter(state, options))
    state = state.apply(suggestEnter(state, options))

    expect(suggestionCards(state.doc).map(cardTitle)).toEqual([
      'Add: 2 new paragraphs',
    ])
  })

  it('rejecting removes the new paragraph; accepting makes it part of the body', () => {
    let state = caretAt(twoParagraphs(), 'first', 5)
    state = state.apply(suggestEnter(state, options))
    const id = suggestionCards(state.doc)[0]!.id

    const rejected = state.apply(
      decideSuggestion(state, id, 'reject').transaction
    )
    expect(paragraphCount(rejected)).toBe(2)
    expect(suggestionCards(rejected.doc)).toEqual([])
    expect(rejected.doc.textContent).toBe('firstsecond')

    const accepted = state.apply(
      decideSuggestion(state, id, 'accept').transaction
    )
    expect(suggestionCards(accepted.doc)).toEqual([])
    expect(paragraphCount(accepted)).toBe(3)
  })

  it('at the start of a paragraph with text adds the paragraph before it', () => {
    let state = caretAt(twoParagraphs(), 'second', 0)

    state = state.apply(suggestEnter(state, options))

    expect(paragraphCount(state)).toBe(2)
    expect(state.doc.child(0).child(1).textContent).toBe('')
    expect(state.doc.child(0).child(2).textContent).toBe('second')
  })
})

describe('pasting lines in Suggest mode', () => {
  it('at the end of a paragraph is one suggestion: the first line as text, the rest as new paragraphs', () => {
    let state = caretAt(twoParagraphs(), 'first', 5)

    state = state.apply(suggestPasteLines(state, ' A\nB\n\nC', options))

    expect(suggestionCards(state.doc)).toHaveLength(1)
    expect(canonicalRuns(state.doc)).toEqual(['first', 'second'])
    expect(paragraphCount(state)).toBe(2)
    const paragraphs = state.doc.child(0)
    expect(
      [...Array(paragraphs.childCount).keys()].map(
        (index) => paragraphs.child(index).textContent
      )
    ).toEqual(['first A', 'B', '', 'C', 'second'])
  })

  it('refuses in the middle of a paragraph', () => {
    const state = caretAt(twoParagraphs(), 'first', 2)

    expect(() => suggestPasteLines(state, 'a\nb', options)).toThrow(
      UnsupportedSuggestionError
    )
  })
})

const paragraphTexts = (state: EditorState) => {
  const body = state.doc.child(0)
  return [...Array(body.childCount).keys()].map(
    (index) => body.child(index).textContent
  )
}

describe('Enter in the middle of text in Suggest mode', () => {
  it('proposes deleting the tail where it is and a copy of it in a new paragraph, as one split', () => {
    let state = caretAt(twoParagraphs(), 'first', 2)

    state = state.apply(suggestEnter(state, options))

    expect(suggestionCards(state.doc).map(cardTitle)).toEqual([
      'Split paragraph',
    ])
    expect(canonicalRuns(state.doc)).toEqual(['first', 'second'])
    expect(paragraphCount(state)).toBe(2)
    expect(paragraphTexts(state)).toEqual(['first', 'rst', 'second'])
  })

  it('accepting leaves two paragraphs and rejecting leaves the original one', () => {
    let state = caretAt(twoParagraphs(), 'first', 2)
    state = state.apply(suggestEnter(state, options))
    const id = suggestionCards(state.doc)[0]!.id

    const accepted = state.apply(
      decideSuggestion(state, id, 'accept').transaction
    )
    expect(paragraphTexts(accepted)).toEqual(['fi', 'rst', 'second'])
    expect(canonicalRuns(accepted.doc)).toEqual(['fi', 'rst', 'second'])
    expect(suggestionCards(accepted.doc)).toEqual([])

    const rejected = state.apply(
      decideSuggestion(state, id, 'reject').transaction
    )
    expect(paragraphTexts(rejected)).toEqual(['first', 'second'])
    expect(suggestionCards(rejected.doc)).toEqual([])
  })

  it("refuses when the tail holds someone else's suggestion", () => {
    const state = caretAt(
      stateOf(
        documentOf(
          paragraph('p1', [
            run('r1', ['ab', { text: 'cd', mark: 'insert', by: OTHER }]),
          ])
        )
      ),
      'ab',
      1
    )

    expect(() => suggestEnter(state, options)).toThrow(
      UnsupportedSuggestionError
    )
  })
})

describe('Backspace at the start of a paragraph in Suggest mode', () => {
  it('proposes deleting the second paragraph and a copy of its text at the end of the first, as one join', () => {
    let state = caretAt(twoParagraphs(), 'second', 0)
    const upper = joinTarget(state, false)
    expect(upper).not.toBeNull()

    state = state.apply(suggestJoin(state, upper!, options))

    expect(suggestionCards(state.doc).map(cardTitle)).toEqual([
      'Join paragraphs',
    ])
    expect(canonicalRuns(state.doc)).toEqual(['first', 'second'])
    expect(paragraphTexts(state)).toEqual(['firstsecond', 'second'])
  })

  it('accepting leaves one paragraph and rejecting leaves two', () => {
    let state = caretAt(twoParagraphs(), 'second', 0)
    state = state.apply(suggestJoin(state, joinTarget(state, false)!, options))
    const id = suggestionCards(state.doc)[0]!.id

    const decision = decideSuggestion(state, id, 'accept')
    expect(decision.structuralDeletes).toEqual(['p2'])
    const accepted = state.apply(decision.transaction)
    expect(accepted.doc.child(0).child(0).textContent).toBe('firstsecond')

    const rejected = state.apply(
      decideSuggestion(state, id, 'reject').transaction
    )
    expect(paragraphTexts(rejected)).toEqual(['first', 'second'])
    expect(suggestionCards(rejected.doc)).toEqual([])
  })

  it('does not apply in the middle of a paragraph or in the first one', () => {
    expect(joinTarget(caretAt(twoParagraphs(), 'second', 2), false)).toBeNull()
    expect(joinTarget(caretAt(twoParagraphs(), 'first', 0), false)).toBeNull()
  })

  it('Delete at the end of a paragraph joins it with the next', () => {
    let state = caretAt(twoParagraphs(), 'first', 5)
    const upper = joinTarget(state, true)
    expect(upper).not.toBeNull()

    state = state.apply(suggestJoin(state, upper!, options))

    expect(suggestionCards(state.doc).map(cardTitle)).toEqual([
      'Join paragraphs',
    ])
  })
})

const nodes = documentBodySchema.nodes
const idAttrs = (nodeID: string) => ({
  nodeID,
  bodyAttributes: '{}',
  bodyContent: '',
})

/** document > bullet_list > list_item > paragraph > run, one item per text. */
function listOf(...texts: string[]) {
  return documentOf(
    nodes.bullet_list!.create(
      idAttrs('list'),
      texts.map((text, index) =>
        nodes.list_item!.create(idAttrs(`item${index}`), [
          paragraph(`para${index}`, [run(`run${index}`, [text])]),
        ])
      )
    )
  )
}

function quoteOf(...texts: string[]) {
  return documentOf(
    nodes.block_quote!.create(
      idAttrs('quote'),
      texts.map((text, index) =>
        paragraph(`qpara${index}`, [run(`qrun${index}`, [text])])
      )
    )
  )
}

const shape = (state: EditorState) => {
  const found: string[] = []
  state.doc.descendants((node) => {
    if (node.type.name === 'list_item' || node.type.name === 'block_quote')
      found.push(`${node.type.name}:${node.childCount}`)
    return true
  })
  return found
}

describe('Enter in a list in Suggest mode', () => {
  it('at the end of an item opens the next item as a suggestion the body does not see', () => {
    let state = caretAt(stateOf(listOf('Apples')), 'Apples', 6)

    state = state.apply(suggestEnter(state, options))

    expect(suggestionCards(state.doc).map(cardTitle)).toEqual([
      'Add: new paragraph',
    ])
    expect(canonicalRuns(state.doc)).toEqual(['Apples'])
    expect(shape(state)).toEqual(['list_item:1', 'list_item:1'])
    expect(state.selection.$from.parent.type.name).toBe('paragraph')
    expect(state.selection.$from.parent.content.size).toBe(0)
  })

  it('puts what is typed into the same suggestion, and accepting or rejecting takes the whole item', () => {
    let state = caretAt(stateOf(listOf('Apples')), 'Apples', 6)
    state = state.apply(suggestEnter(state, options))
    state = state.apply(
      suggestReplace(
        state,
        state.selection.from,
        state.selection.to,
        'Pears',
        options
      )
    )
    const cards = suggestionCards(state.doc)
    expect(cards.map(cardTitle)).toEqual(['Add: "Pears"'])
    expect(canonicalRuns(state.doc)).toEqual(['Apples'])

    const accepted = state.apply(
      decideSuggestion(state, cards[0]!.id, 'accept').transaction
    )
    expect(shape(accepted)).toEqual(['list_item:1', 'list_item:1'])
    expect(accepted.doc.textContent).toBe('ApplesPears')
    expect(suggestionCards(accepted.doc)).toEqual([])

    const rejected = state.apply(
      decideSuggestion(state, cards[0]!.id, 'reject').transaction
    )
    expect(shape(rejected)).toEqual(['list_item:1'])
    expect(rejected.doc.textContent).toBe('Apples')
  })

  it('keeps pressing Enter in your own new item in the same suggestion', () => {
    let state = caretAt(stateOf(listOf('Apples')), 'Apples', 6)
    state = state.apply(suggestEnter(state, options))
    state = state.apply(suggestEnter(state, options))

    expect(suggestionCards(state.doc).map(cardTitle)).toEqual([
      'Add: 2 new paragraphs',
    ])
    expect(shape(state)).toEqual(['list_item:1', 'list_item:1', 'list_item:1'])
  })

  it('splits an item in the middle by copying its tail into a new item', () => {
    let state = caretAt(stateOf(listOf('Apples', 'Pears')), 'Apples', 3)
    state = state.apply(suggestEnter(state, options))

    const cards = suggestionCards(state.doc)
    expect(cards.map(cardTitle)).toEqual(['Split paragraph'])
    expect(canonicalRuns(state.doc)).toEqual(['Apples', 'Pears'])
    expect(shape(state)).toEqual(['list_item:1', 'list_item:1', 'list_item:1'])

    const accepted = state.apply(
      decideSuggestion(state, cards[0]!.id, 'accept').transaction
    )
    expect(shape(accepted)).toEqual([
      'list_item:1',
      'list_item:1',
      'list_item:1',
    ])
    expect(accepted.doc.textContent).toBe('ApplesPears')
    const rejected = state.apply(
      decideSuggestion(state, cards[0]!.id, 'reject').transaction
    )
    expect(shape(rejected)).toEqual(['list_item:1', 'list_item:1'])
    expect(rejected.doc.textContent).toBe('ApplesPears')
  })

  it('opens an item above when the caret is at the start of an item with text', () => {
    let state = caretAt(stateOf(listOf('Apples')), 'Apples', 0)
    state = state.apply(suggestEnter(state, options))

    expect(suggestionCards(state.doc).map(cardTitle)).toEqual([
      'Add: new paragraph',
    ])
    expect(canonicalRuns(state.doc)).toEqual(['Apples'])
    expect(shape(state)).toEqual(['list_item:1', 'list_item:1'])
    expect(state.selection.$from.parent.textContent).toBe('Apples')
  })

  it('leaves the list from an empty last item: the item goes, a paragraph follows the list', () => {
    const empty = stateOf(
      documentOf(
        nodes.bullet_list!.create(idAttrs('list'), [
          nodes.list_item!.create(idAttrs('item0'), [
            paragraph('para0', [run('run0', ['Apples'])]),
          ]),
          nodes.list_item!.create(idAttrs('item1'), [
            nodes.paragraph!.create(idAttrs('para1')),
          ]),
        ])
      )
    )
    let state = empty
    state.doc.descendants((node, pos) => {
      if (node.attrs.nodeID === 'para1')
        state = state.apply(
          state.tr.setSelection(TextSelection.create(state.doc, pos + 1))
        )
      return true
    })

    state = state.apply(suggestEnter(state, options))

    const cards = suggestionCards(state.doc)
    expect(cards).toHaveLength(1)
    expect(state.doc.firstChild?.lastChild?.type.name).toBe('paragraph')
    const accepted = decideSuggestion(state, cards[0]!.id, 'accept')
    expect(accepted.structuralDeletes).toEqual(['item1'])
    const rejected = state.apply(
      decideSuggestion(state, cards[0]!.id, 'reject').transaction
    )
    expect(rejected.doc.childCount).toBe(1)
    expect(shape(rejected)).toEqual(['list_item:1', 'list_item:1'])
  })

  it('refuses leaving the list from the only item', () => {
    const only = stateOf(
      documentOf(
        nodes.bullet_list!.create(idAttrs('list'), [
          nodes.list_item!.create(idAttrs('item'), [
            nodes.paragraph!.create(idAttrs('para')),
          ]),
        ])
      )
    )
    const inEmpty = only.apply(
      only.tr.setSelection(TextSelection.create(only.doc, 4))
    )
    expect(() => suggestEnter(inEmpty, options)).toThrow(
      UnsupportedSuggestionError
    )
  })

  it('joins two items with Backspace as one suggestion: the second item goes, its text joins the first', () => {
    let state = caretAt(stateOf(listOf('Apples', 'Pears')), 'Pears', 0)
    const upper = joinTarget(state, false)
    expect(upper).not.toBeNull()
    state = state.apply(suggestJoin(state, upper!, options))

    const cards = suggestionCards(state.doc)
    expect(cards.map(cardTitle)).toEqual(['Join paragraphs'])
    expect(canonicalRuns(state.doc)).toEqual(['Apples', 'Pears'])

    const accepted = decideSuggestion(state, cards[0]!.id, 'accept')
    expect(accepted.structuralDeletes).toEqual(['item1'])
    const rejected = state.apply(
      decideSuggestion(state, cards[0]!.id, 'reject').transaction
    )
    expect(rejected.doc.textContent).toBe('ApplesPears')
    expect(shape(rejected)).toEqual(['list_item:1', 'list_item:1'])
  })

  it('Delete at the end of an item joins it with the next one, and the first item has nothing to join into', () => {
    const forward = caretAt(stateOf(listOf('Apples', 'Pears')), 'Apples', 6)
    expect(joinTarget(forward, true)).not.toBeNull()
    const first = caretAt(stateOf(listOf('Apples', 'Pears')), 'Apples', 0)
    expect(joinTarget(first, false)).toBeNull()
  })
})

describe('Enter, split, and join in a quote in Suggest mode', () => {
  it('behave as in the document, inside the quote', () => {
    let state = caretAt(stateOf(quoteOf('Quoted')), 'Quoted', 6)
    state = state.apply(suggestEnter(state, options))
    expect(shape(state)).toEqual(['block_quote:2'])
    expect(canonicalRuns(state.doc)).toEqual(['Quoted'])

    let split = caretAt(stateOf(quoteOf('Quoted')), 'Quoted', 3)
    split = split.apply(suggestEnter(split, options))
    expect(suggestionCards(split.doc).map(cardTitle)).toEqual([
      'Split paragraph',
    ])
    expect(shape(split)).toEqual(['block_quote:2'])

    let join = caretAt(stateOf(quoteOf('One', 'Two')), 'Two', 0)
    const upper = joinTarget(join, false)
    expect(upper).not.toBeNull()
    join = join.apply(suggestJoin(join, upper!, options))
    expect(suggestionCards(join.doc).map(cardTitle)).toEqual([
      'Join paragraphs',
    ])
  })
})
