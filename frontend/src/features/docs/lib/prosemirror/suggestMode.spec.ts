import { TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { prosemirrorToYDoc } from 'y-prosemirror'
import { documentBodyToProseMirror } from './documentBody'
import { mountTestEditor, paragraphsBody, runStart } from './editorTestKit'
import { cardTitle, type SuggestionCard } from './suggestionCards'

// Suggest mode with a real keyboard: what the user types is recorded as
// suggestions in the body, and the canonical body stays what it was.

const ME = '00000000-0000-4000-8000-0000000000a1'

function suggestEditor(...texts: string[]) {
  const refused: string[] = []
  const deletes: string[][] = []
  let cards: SuggestionCard[] = []
  const mounted = mountTestEditor(paragraphsBody(...texts), {
    suggestAuthor: ME,
    onSuggestRefused: (message) => refused.push(message),
    onDeleteNode: (nodeIDs) => {
      deletes.push(nodeIDs)
    },
    onSuggestionCards: (next) => {
      cards = next
    },
  })
  mounted.editor.setSuggestMode(true)
  mounted.editor.view.focus()
  const { view } = mounted.editor
  return {
    ...mounted,
    refused,
    deletes,
    cards: () => cards,
    titles: () => cards.map(cardTitle),
    canonical: () =>
      mounted.editor
        .getBody()
        .filter((node) => node.type === 'run')
        .map((node) => node.content),
    caret(text: string, offset: number) {
      const at = runStart(view.state.doc, text) + offset
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, at))
      )
    },
    select(text: string, from: number, to: number) {
      const start = runStart(view.state.doc, text)
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, start + from, start + to)
        )
      )
    },
    dom: (selector: string) =>
      [...mounted.host.querySelectorAll(selector)].map(
        (node) => node.textContent
      ),
  }
}

describe('Suggest mode, typing', () => {
  it('records typed text as an addition and leaves the canonical body alone', async () => {
    const editor = suggestEditor('hello')
    try {
      editor.caret('hello', 5)
      await userEvent.keyboard('!!')

      expect(editor.titles()).toEqual(['Add: "!!"'])
      expect(editor.canonical()).toEqual(['hello'])
      expect(editor.dom('.suggest-ins')).toEqual(['!!'])
    } finally {
      editor.cleanup()
    }
  })

  it('starts a new card after the caret moves away and returns', async () => {
    const editor = suggestEditor('hello')
    try {
      editor.caret('hello', 5)
      await userEvent.keyboard('A')
      editor.caret('helloA', 0)
      editor.caret('helloA', 6)
      await userEvent.keyboard('B')

      expect(editor.titles()).toEqual(['Add: "A"', 'Add: "B"'])
    } finally {
      editor.cleanup()
    }
  })

  it('starts a new card after another user changes the body', async () => {
    const editor = suggestEditor('hello')
    try {
      editor.caret('hello', 5)
      await userEvent.keyboard('A')
      const { view } = editor.editor
      view.dispatch(
        view.state.tr
          .insertText('X', runStart(view.state.doc, 'helloA'))
          .setMeta('y-sync$', { isChangeOrigin: true })
      )
      editor.caret('XhelloA', 7)
      await userEvent.keyboard('B')

      expect(editor.titles()).toEqual(['Add: "A"', 'Add: "B"'])
    } finally {
      editor.cleanup()
    }
  })

  it('records Backspace as a deletion that stays visible', async () => {
    const editor = suggestEditor('hello')
    try {
      editor.caret('hello', 5)
      await userEvent.keyboard('{Backspace}{Backspace}')

      expect(editor.titles()).toEqual(['Delete: "lo"'])
      expect(editor.canonical()).toEqual(['hello'])
      expect(editor.dom('.suggest-del')).toEqual(['lo'])
    } finally {
      editor.cleanup()
    }
  })

  it('makes typing over a selection one Replace', async () => {
    const editor = suggestEditor('a cat sat')
    try {
      editor.select('a cat sat', 2, 5)
      await userEvent.keyboard('dog')

      expect(editor.titles()).toEqual(['Replace: "cat" with "dog"'])
      expect(editor.canonical()).toEqual(['a cat sat'])
    } finally {
      editor.cleanup()
    }
  })

  it('makes delete then typing at the same place one Replace', async () => {
    const editor = suggestEditor('a cat sat')
    try {
      editor.caret('a cat sat', 5)
      await userEvent.keyboard('{Backspace}{Backspace}{Backspace}dog')

      expect(editor.titles()).toEqual(['Replace: "cat" with "dog"'])
    } finally {
      editor.cleanup()
    }
  })

  it('turns select all and Delete into a suggestion to delete every paragraph', async () => {
    const editor = suggestEditor('first', 'second')
    try {
      await userEvent.keyboard('{Control>}a{/Control}{Delete}')

      expect(editor.refused).toEqual([])
      expect(editor.titles()).toHaveLength(1)
      expect(editor.titles()[0]).toMatch(/^Delete: "/)
      expect(editor.canonical()).toEqual(['first', 'second'])
      // Each paragraph is highlighted as a whole.
      expect(editor.dom('.suggest-block-del')).toHaveLength(2)
    } finally {
      editor.cleanup()
    }
  })

  it('undoes a suggestion with Ctrl+Z', async () => {
    const editor = suggestEditor('hello')
    try {
      editor.caret('hello', 5)
      await userEvent.keyboard('!')
      expect(editor.titles()).toEqual(['Add: "!"'])

      await userEvent.keyboard('{Control>}z{/Control}')

      expect(editor.titles()).toEqual([])
      expect(editor.dom('.suggest-ins')).toEqual([])
    } finally {
      editor.cleanup()
    }
  })
})

describe('Suggest mode, what it refuses', () => {
  it('refuses Enter, saying so, and changes nothing', async () => {
    const editor = suggestEditor('hello')
    try {
      editor.caret('hello', 2)
      await userEvent.keyboard('{Enter}')

      expect(editor.refused).toHaveLength(1)
      expect(editor.titles()).toEqual([])
      expect(editor.canonical()).toEqual(['hello'])
    } finally {
      editor.cleanup()
    }
  })

  it('refuses a formatting shortcut', async () => {
    const editor = suggestEditor('hello')
    try {
      editor.select('hello', 0, 5)
      await userEvent.keyboard('{Control>}b{/Control}')

      expect(editor.refused).toHaveLength(1)
      expect(editor.titles()).toEqual([])
    } finally {
      editor.cleanup()
    }
  })

  it('accepts a single-line paste and refuses a multi-line one', () => {
    const editor = suggestEditor('hello')
    try {
      editor.caret('hello', 5)
      const paste = (text: string) => {
        const data = new DataTransfer()
        data.setData('text/plain', text)
        editor.editor.view.dom.dispatchEvent(
          new ClipboardEvent('paste', {
            clipboardData: data,
            bubbles: true,
            cancelable: true,
          })
        )
      }
      paste(' there')
      expect(editor.titles()).toEqual(['Add: " there"'])

      paste('one\ntwo')
      expect(editor.refused).toHaveLength(1)
      expect(editor.titles()).toEqual(['Add: " there"'])
    } finally {
      editor.cleanup()
    }
  })
})

describe('Suggest mode, deciding', () => {
  it('accepting an addition makes it canonical, and rejecting removes it', async () => {
    const editor = suggestEditor('hello')
    try {
      editor.caret('hello', 5)
      await userEvent.keyboard('!')
      const [card] = editor.cards()

      editor.editor.decide(card!.id, 'reject')
      expect(editor.canonical()).toEqual(['hello'])
      expect(editor.titles()).toEqual([])

      await userEvent.keyboard('?')
      editor.editor.decide(editor.cards()[0]!.id, 'accept')
      expect(editor.canonical()).toEqual(['hello?'])
      expect(editor.titles()).toEqual([])
    } finally {
      editor.cleanup()
    }
  })

  it('sends the paragraphs of an accepted deletion to the structural delete', async () => {
    const editor = suggestEditor('first', 'second')
    try {
      await userEvent.keyboard('{Control>}a{/Control}{Delete}')

      const structural = editor.editor.decide(editor.cards()[0]!.id, 'accept')
      await Promise.resolve()

      expect(structural).toEqual(['p0', 'p1'])
      expect(editor.deletes).toEqual([['p0', 'p1']])
    } finally {
      editor.cleanup()
    }
  })
})

describe('Suggest mode, other people’s suggestions', () => {
  it('draws a suggestion that arrived with the body in its author’s color', () => {
    const other = '00000000-0000-4000-8000-0000000000a2'
    const doc = documentBodyToProseMirror(paragraphsBody('hello'))
    const ydoc = prosemirrorToYDoc(doc, 'body')
    const mounted = mountTestEditor(
      paragraphsBody('hello'),
      { suggestAuthor: ME },
      ydoc
    )
    try {
      mounted.editor.setSuggestMode(true)
      mounted.editor.focus()
      const view = mounted.editor.view
      const at = runStart(view.state.doc, 'hello') + 5
      // Another user's insertion, applied the way a remote update is.
      view.dispatch(
        view.state.tr
          .insertText('!', at)
          .addMark(
            at,
            at + 1,
            view.state.schema.marks.suggestion_insert!.create({
              id: ME,
              author: other,
            })
          )
          .setMeta('y-sync$', { isChangeOrigin: true })
      )

      const span = mounted.host.querySelector('.suggest-ins') as HTMLElement
      expect(span.textContent).toBe('!')
      expect(span.style.getPropertyValue('--suggest-color')).toBe('#4D7C0F')
    } finally {
      mounted.cleanup()
    }
  })
})
