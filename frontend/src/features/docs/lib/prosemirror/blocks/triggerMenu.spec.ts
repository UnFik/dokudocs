import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareBodyTransaction } from '../prepareBodyTransaction'
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
const input = (host: HTMLElement) =>
  host.querySelector<HTMLInputElement>('[role="combobox"]')
const wait = () => new Promise((resolve) => setTimeout(resolve, 20))
const type = (box: HTMLInputElement, value: string) => {
  box.value = value
  box.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('@ mention menu', () => {
  it('opens on @ at the start of a word, without writing the @', () => {
    const { view, host } = mount('hello ')
    expect(press(view.dom, '@').defaultPrevented).toBe(true)
    expect(input(host)?.getAttribute('aria-label')).toBe('Mention')
    expect(view.state.doc.textContent).toBe('hello ')
  })

  it('does not open inside a word, as in an email address', () => {
    const { view, host } = mount('name')
    expect(press(view.dom, '@').defaultPrevented).toBe(false)
    expect(input(host)).toBeNull()
  })

  it('lists people, pages and projects, narrowed as the person types', async () => {
    const { view, host } = mount('')
    press(view.dom, '@')
    await wait()
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(4)
    type(input(host)!, 'rin')
    await wait()
    expect(
      [...host.querySelectorAll('[role="option"]')].map((o) => o.textContent)
    ).toEqual([expect.stringContaining('Rina Putri')])
  })

  it('inserts the chosen one as a mention that knows what it points to', async () => {
    const { view, host } = mount('hi ')
    press(view.dom, '@')
    await wait()
    type(input(host)!, 'launch')
    await wait()
    press(input(host)!, 'Enter')
    const mention = bodyOf(view.state.doc).find(
      (node) => node.type === 'mention'
    )!
    expect(mention.attributes).toEqual({
      kind: 'document',
      id: 'd-1',
      label: 'Launch plan',
    })
    expect(input(host)).toBeNull()
  })

  it('closes on Escape and leaves the page alone', async () => {
    const { view, host } = mount('')
    press(view.dom, '@')
    press(input(host)!, 'Escape')
    expect(input(host)).toBeNull()
    expect(view.state.doc.textContent).toBe('')
  })

  it('does not open when it is not enabled', () => {
    const { view } = mount('', false)
    expect(press(view.dom, '@').defaultPrevented).toBe(false)
  })
})

describe('emoji menu', () => {
  it('finds an emoji by name or alias', () => {
    expect(filterEmojis('smile').map((item) => item.emoji)).toContain('😄')
    expect(filterEmojis('zzzzzzz')).toEqual([])
  })

  it('opens on :, filters and inserts the emoji as text', async () => {
    const { view, host } = mount('great ')
    expect(press(view.dom, ':').defaultPrevented).toBe(true)
    expect(input(host)?.getAttribute('aria-label')).toBe('Emoji')
    type(input(host)!, 'tada')
    await wait()
    press(input(host)!, 'Enter')
    expect(view.state.doc.textContent).toBe('great 🎉')
  })

  it('does not open after a digit, so 10:30 stays text', () => {
    const { view, host } = mount('10')
    expect(press(view.dom, ':').defaultPrevented).toBe(false)
    expect(input(host)).toBeNull()
  })
})

describe('a menu with nothing to offer', () => {
  it('gives the typed characters back to the page, so ::: can start a notice', async () => {
    const { view, host } = mount('')
    press(view.dom, ':')
    type(input(host)!, '::')
    await wait()
    expect(input(host)).toBeNull()
    expect(view.state.doc.textContent).toBe(':::')
  })

  it('keeps open while something still matches', async () => {
    const { view, host } = mount('hello ')
    press(view.dom, '@')
    type(input(host)!, 'Rin')
    await wait()
    expect(input(host)).not.toBeNull()
    expect(view.state.doc.textContent).toBe('hello ')
  })
})
