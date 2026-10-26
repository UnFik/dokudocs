import { EditorState, Selection, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareBodyTransaction } from '../prepareBodyTransaction'
import { blockMenuPlugin } from './blockMenu'
import { bodyBuilder, bodyOf, stateFor } from './testSupport'
import {
  emojiMenuPlugin,
  filterEmojis,
  mentionMenuPlugin,
  type MentionCandidate,
} from './triggerMenu'

const views: EditorView[] = []
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy())
  document.body.replaceChildren()
})

const people: MentionCandidate[] = [
  { kind: 'person', id: 'u-1', label: 'Rina Putri', hint: 'Member' },
  { kind: 'person', id: 'u-2', label: 'Dewi Lestari', hint: 'Member' },
  { kind: 'document', id: 'd-1', label: 'Launch plan', hint: 'Page' },
  { kind: 'project', id: 'p-1', label: 'Apollo', hint: 'Project' },
]

function mount(text: string, enabled = true) {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  const p = b.add(root, 'paragraph')
  if (text) b.add(p, 'run', text)
  // The caret sits at the end of the text, inside the run.
  const start = stateFor(b.nodes, p, text ? text.length + 1 : 0)
  const host = document.createElement('div')
  document.body.append(host)
  const view: EditorView = new EditorView(host, {
    state: EditorState.create({
      doc: start.doc,
      selection: start.selection,
      plugins: [
        blockMenuPlugin(),
        mentionMenuPlugin({
          enabled: () => enabled,
          search: async (query) =>
            people.filter((item) =>
              item.label.toLowerCase().includes(query.toLowerCase())
            ),
        }),
        emojiMenuPlugin(() => enabled),
      ],
    }),
    dispatchTransaction(tr) {
      const next = tr.docChanged ? prepareBodyTransaction(view.state, tr) : tr
      view.updateState(view.state.apply(next))
    },
  })
  views.push(view)
  view.focus()
  return { view, host }
}

function press(target: EventTarget, key: string) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return event
}
const wait = () => new Promise((resolve) => setTimeout(resolve, 20))
/** Types into the page, one character at a time, as the keyboard does. */
const typeText = (view: EditorView, text: string) => {
  for (const char of text) view.dispatch(view.state.tr.insertText(char))
}
const options = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLElement>('.dd-slash [role="option"]'),
]
const menuOf = (host: HTMLElement) => host.querySelector('.dd-slash')
const label = (view: EditorView) => view.dom.getAttribute('aria-label')

describe('@ mention menu', () => {
  it('opens on @ at the start of a word and writes the @ into the page', () => {
    const { view, host } = mount('hello ')
    expect(press(view.dom, '@').defaultPrevented).toBe(true)
    expect(menuOf(host)).not.toBeNull()
    expect(label(view)).toBe('Mention')
    expect(host.querySelector('input')).toBeNull()
    expect(view.state.doc.textContent).toBe('hello @')
  })

  it('does not open inside a word, as in an email address', () => {
    const { view, host } = mount('name')
    expect(press(view.dom, '@').defaultPrevented).toBe(false)
    expect(menuOf(host)).toBeNull()
  })

  it('lists people, pages and projects, narrowed by what is typed after the @', async () => {
    const { view, host } = mount('')
    press(view.dom, '@')
    await wait()
    expect(options(host)).toHaveLength(4)
    typeText(view, 'rin')
    await wait()
    expect(options(host).map((o) => o.textContent)).toEqual([
      expect.stringContaining('Rina Putri'),
    ])
    expect(view.state.doc.textContent).toBe('@rin')
  })

  it('searches a name with a space in it', async () => {
    const { view, host } = mount('')
    press(view.dom, '@')
    typeText(view, 'rina p')
    await wait()
    expect(options(host)).toHaveLength(1)
  })

  it('replaces the @ and the query with the chosen mention', async () => {
    const { view, host } = mount('hi ')
    press(view.dom, '@')
    typeText(view, 'launch')
    await wait()
    press(view.dom, 'Enter')
    const mention = bodyOf(view.state.doc).find(
      (node) => node.type === 'mention'
    )!
    expect(mention.attributes).toEqual({
      kind: 'document',
      id: 'd-1',
      label: 'Launch plan',
    })
    expect(view.state.doc.textContent).not.toContain('@')
    expect(view.state.doc.textContent).not.toContain('launch')
    expect(menuOf(host)).toBeNull()
  })

  it('chooses with a click on an option', async () => {
    const { view, host } = mount('')
    press(view.dom, '@')
    await wait()
    options(host)[3]!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    )
    expect(
      bodyOf(view.state.doc).find((node) => node.type === 'mention')!.attributes
    ).toMatchObject({ kind: 'project', id: 'p-1' })
  })

  it('closes on Escape and leaves what was typed in the page', async () => {
    const { view, host } = mount('')
    press(view.dom, '@')
    typeText(view, 'ri')
    press(view.dom, 'Escape')
    expect(menuOf(host)).toBeNull()
    expect(view.state.doc.textContent).toBe('@ri')
  })

  it('closes when the caret leaves the query', async () => {
    const { view, host } = mount('')
    press(view.dom, '@')
    await wait()
    view.dispatch(view.state.tr.setSelection(Selection.atStart(view.state.doc)))
    expect(menuOf(host)).toBeNull()
  })

  it('does not open when it is not enabled', () => {
    const { view } = mount('', false)
    expect(press(view.dom, '@').defaultPrevented).toBe(false)
  })
})

describe('menu keys and scrolling', () => {
  it('moves the active option with the arrow keys and keeps it in view', async () => {
    const { view, host } = mount('')
    press(view.dom, '@')
    await wait()
    const scrolled: Element[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function () {
      scrolled.push(this)
    }
    try {
      expect(press(view.dom, 'ArrowDown').defaultPrevented).toBe(true)
      press(view.dom, 'ArrowDown')
    } finally {
      Element.prototype.scrollIntoView = original
    }
    expect(host.querySelector('[aria-selected="true"]')?.textContent).toContain(
      'Launch plan'
    )
    expect(scrolled.at(-1)?.textContent).toContain('Launch plan')
    expect(view.dom.getAttribute('aria-activedescendant')).toBe(
      host.querySelector('[aria-selected="true"]')?.id
    )
  })
})

describe('Mention entry in the / menu', () => {
  const askForMention = async (view: EditorView) => {
    press(view.dom, '/')
    typeText(view, 'mention')
    press(view.dom, 'Enter')
    await wait()
  }

  it('opens the mention dropdown with people, pages and projects', async () => {
    const { view, host } = mount('')
    await askForMention(view)
    expect(label(view)).toBe('Mention')
    expect(options(host)).toHaveLength(4)
    expect(view.state.doc.textContent).toBe('@')
  })

  it('inserts the chosen page as a mention', async () => {
    const { view } = mount('')
    await askForMention(view)
    typeText(view, 'launch')
    await wait()
    press(view.dom, 'Enter')
    const mention = bodyOf(view.state.doc).find(
      (node) => node.type === 'mention'
    )!
    expect(mention.attributes).toMatchObject({ kind: 'document', id: 'd-1' })
  })

  it('does nothing when mentions are not enabled', async () => {
    const { view, host } = mount('', false)
    await askForMention(view)
    expect(menuOf(host)).toBeNull()
  })
})

describe('emoji menu', () => {
  it('finds an emoji by name or alias', () => {
    expect(filterEmojis('smile').map((item) => item.emoji)).toContain('😄')
    expect(filterEmojis('zzzzzzz')).toEqual([])
  })

  it('opens on :, filters by what is typed and inserts the emoji as text', async () => {
    const { view } = mount('great ')
    expect(press(view.dom, ':').defaultPrevented).toBe(true)
    expect(label(view)).toBe('Emoji')
    typeText(view, 'tada')
    await wait()
    press(view.dom, 'Enter')
    expect(view.state.doc.textContent).toBe('great 🎉')
  })

  it('stays open when typing rewrites the line around the trigger', async () => {
    const { view } = mount('great ')
    // After the run, as when the caret sits behind a mention chip: each typed
    // letter then becomes a run of its own and the line is rebuilt.
    const outside = view.state.selection.from + 1
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, outside))
    )
    press(view.dom, ':')
    typeText(view, 'tada')
    await wait()
    expect(label(view)).toBe('Emoji')
    press(view.dom, 'Enter')
    expect(view.state.doc.textContent).toBe('great 🎉')
  })

  it('does not open after a digit, so 10:30 stays text', () => {
    const { view, host } = mount('10')
    expect(press(view.dom, ':').defaultPrevented).toBe(false)
    expect(menuOf(host)).toBeNull()
  })
})

describe('a menu with nothing to offer', () => {
  it('closes and keeps the typed characters, so ::: can start a notice', async () => {
    const { view, host } = mount('')
    press(view.dom, ':')
    typeText(view, '::')
    await wait()
    expect(menuOf(host)).toBeNull()
    expect(view.state.doc.textContent).toBe(':::')
  })

  it('keeps open while something still matches', async () => {
    const { view, host } = mount('hello ')
    press(view.dom, '@')
    typeText(view, 'Rin')
    await wait()
    expect(menuOf(host)).not.toBeNull()
    expect(view.state.doc.textContent).toBe('hello @Rin')
  })
})
