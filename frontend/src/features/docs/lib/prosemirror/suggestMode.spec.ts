import { TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { prosemirrorToYDoc } from 'y-prosemirror'
import { documentBodyToMarkdown } from '../muya/state/documentBodyToMarkdown'
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

describe('Suggest mode, structure', () => {
  it('Enter at the end of a paragraph suggests a new paragraph that typing then fills, and rejecting removes it', async () => {
    const editor = suggestEditor('hello')
    try {
      editor.caret('hello', 5)
      await userEvent.keyboard('{Enter}')
      expect(editor.titles()).toEqual(['Add: new paragraph'])
      expect(editor.refused).toEqual([])

      await userEvent.keyboard('next')
      expect(editor.titles()).toEqual(['Add: "next"'])
      expect(editor.canonical()).toEqual(['hello'])

      editor.editor.decide(editor.cards()[0]!.id, 'reject')
      expect(editor.titles()).toEqual([])
      expect(editor.editor.getBody().map((node) => node.type)).toEqual([
        'document',
        'paragraph',
        'run',
      ])
    } finally {
      editor.cleanup()
    }
  })

  it('pastes several lines at the end of a paragraph as one suggestion', () => {
    const editor = suggestEditor('hello')
    try {
      editor.caret('hello', 5)
      const data = new DataTransfer()
      data.setData('text/plain', ' one\ntwo')
      editor.editor.view.dom.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        })
      )
      expect(editor.cards()).toHaveLength(1)
      expect(editor.canonical()).toEqual(['hello'])
      editor.editor.decide(editor.cards()[0]!.id, 'accept')
      expect(editor.canonical()).toEqual(['hello one', 'two'])
    } finally {
      editor.cleanup()
    }
  })
})

describe('Suggest mode, split and join', () => {
  it('Enter in the middle of text suggests a split that accepting makes two paragraphs', async () => {
    const editor = suggestEditor('hello')
    try {
      editor.caret('hello', 2)
      await userEvent.keyboard('{Enter}')
      expect(editor.refused).toEqual([])
      expect(editor.titles()).toEqual(['Split paragraph'])
      expect(editor.canonical()).toEqual(['hello'])

      editor.editor.decide(editor.cards()[0]!.id, 'accept')
      expect(editor.deletes.flat()).toEqual([])
      expect(editor.canonical()).toEqual(['he', 'llo'])
    } finally {
      editor.cleanup()
    }
  })

  it('Backspace at the start of a paragraph suggests a join that rejecting undoes', async () => {
    const editor = suggestEditor('one', 'two')
    try {
      editor.caret('two', 0)
      await userEvent.keyboard('{Backspace}')
      expect(editor.refused).toEqual([])
      expect(editor.titles()).toEqual(['Join paragraphs'])
      expect(editor.canonical()).toEqual(['one', 'two'])

      editor.editor.decide(editor.cards()[0]!.id, 'reject')
      expect(editor.titles()).toEqual([])
      expect(editor.canonical()).toEqual(['one', 'two'])
    } finally {
      editor.cleanup()
    }
  })
})

describe('Suggest mode, block types', () => {
  it('Ctrl+Alt+2 proposes a heading, and accepting makes the block one', async () => {
    const editor = suggestEditor('Title')
    try {
      editor.caret('Title', 2)
      await userEvent.keyboard('{Control>}{Alt>}2{/Alt}{/Control}')
      expect(editor.refused).toEqual([])
      expect(editor.titles()).toEqual(['Format: heading 2 "Title"'])
      expect(editor.dom('h2')).toEqual([])
      expect(editor.dom('[data-suggest-label]')).toHaveLength(1)

      editor.editor.decide(editor.cards()[0]!.id, 'accept')
      expect(editor.dom('h2')).toEqual(['Title'])
      expect(editor.titles()).toEqual([])
    } finally {
      editor.cleanup()
    }
  })
})

describe('Suggest mode, links', () => {
  it('proposes a link on a selection through the editor, and accepting links the text', () => {
    const editor = suggestEditor('hello')
    try {
      editor.select('hello', 0, 5)
      expect(editor.editor.setLink('https://example.com')).toBe(true)
      expect(editor.refused).toEqual([])
      expect(editor.titles()).toEqual(['Format: link "hello"'])
      expect(editor.dom('[data-link-href]')).toEqual([])

      editor.editor.decide(editor.cards()[0]!.id, 'accept')
      expect(editor.dom('[data-link-href="https://example.com"]')).toEqual([
        'hello',
      ])
    } finally {
      editor.cleanup()
    }
  })

  it('refuses an unsafe address with a message', () => {
    const editor = suggestEditor('hello')
    try {
      editor.select('hello', 0, 5)
      editor.editor.setLink('javascript:alert(1)')
      expect(editor.refused).toHaveLength(1)
      expect(editor.titles()).toEqual([])
    } finally {
      editor.cleanup()
    }
  })
})

describe('Suggest mode, formatting after a split', () => {
  it('formats the first half of an accepted split', async () => {
    const editor = suggestEditor('hello world')
    const errors: unknown[] = []
    try {
      editor.caret('hello world', 5)
      await userEvent.keyboard('{Enter}')
      editor.editor.decide(editor.cards()[0]!.id, 'accept')
      expect(editor.canonical()).toEqual(['hello', ' world'])
      expect(() =>
        documentBodyToMarkdown(editor.editor.getBody())
      ).not.toThrow()

      editor.select('hello', 0, 5)
      await userEvent.keyboard('{Control>}b{/Control}')
      expect(errors).toEqual([])
      expect(editor.refused).toEqual([])
      expect(editor.titles()).toEqual(['Format: bold "hello"'])
    } finally {
      editor.cleanup()
    }
  })
})

describe('Suggest mode, what it refuses', () => {
  it('turns a formatting shortcut on a selection into a Format suggestion', async () => {
    const editor = suggestEditor('hello')
    try {
      editor.select('hello', 0, 5)
      await userEvent.keyboard('{Control>}b{/Control}')

      expect(editor.refused).toEqual([])
      expect(editor.titles()).toEqual(['Format: bold "hello"'])
      expect(
        editor.editor.getBody().map((node) => node.attributes)
      ).not.toContain(expect.stringContaining('strong'))

      editor.editor.decide(editor.cards()[0]!.id, 'accept')
      expect(editor.titles()).toEqual([])
      expect(editor.dom('strong')).toEqual(['hello'])
    } finally {
      editor.cleanup()
    }
  })

  it('accepts a single-line paste and refuses a multi-line one in the middle of text', () => {
    const editor = suggestEditor('hello')
    try {
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
      editor.caret('hello', 2)
      paste('one\ntwo')
      expect(editor.refused).toHaveLength(1)
      expect(editor.titles()).toEqual([])
      editor.caret('hello', 5)
      paste(' there')
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
