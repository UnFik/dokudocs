import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { bodyBuilder } from './blocks/testSupport'
import { documentBodyToProseMirror } from './documentBody'
import { findMatches, findReplacePlugin } from './findReplace'

const views: EditorView[] = []
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy())
  document.body.replaceChildren()
})

function body() {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  const p1 = b.add(root, 'paragraph')
  b.add(p1, 'run', 'The cat sat. ')
  b.add(p1, 'run', 'Cat again', { bold: true })
  const p2 = b.add(root, 'paragraph')
  b.add(p2, 'run', 'no match here, but a CAT')
  return documentBodyToProseMirror(b.nodes)
}

describe('findMatches', () => {
  it('finds every match, ignoring case, and across runs of one line', () => {
    const doc = body()
    const found = findMatches(doc, 'cat')
    expect(found.map((range) => doc.textBetween(range.from, range.to))).toEqual(
      ['cat', 'Cat', 'CAT']
    )
  })

  it('finds a match that spans two runs', () => {
    const doc = body()
    const found = findMatches(doc, '. Cat')
    expect(found).toHaveLength(1)
    expect(doc.textBetween(found[0]!.from, found[0]!.to)).toBe('. Cat')
  })

  it('matches nothing for an empty query', () => {
    expect(findMatches(body(), '')).toEqual([])
  })

  it('can match case', () => {
    const doc = body()
    expect(findMatches(doc, 'Cat', { matchCase: true })).toHaveLength(1)
  })
})

function mount(editable = true) {
  const host = document.createElement('div')
  document.body.append(host)
  const view = new EditorView(host, {
    state: EditorState.create({ doc: body(), plugins: [findReplacePlugin()] }),
    editable: () => editable,
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(tr))
    },
  })
  views.push(view)
  return { view, host }
}

function press(
  view: EditorView,
  key: string,
  modifiers: KeyboardEventInit = {}
) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  })
  view.dom.dispatchEvent(event)
  return event
}

const panel = (host: HTMLElement) => host.querySelector<HTMLElement>('.dd-find')
const field = (host: HTMLElement, label: string) =>
  host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
const type = (input: HTMLInputElement, value: string) => {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('find and replace panel', () => {
  it('opens on Ctrl+F with the field focused', () => {
    const { view, host } = mount()
    const event = press(view, 'f', { ctrlKey: true })
    expect(event.defaultPrevented).toBe(true)
    expect(panel(host)).not.toBeNull()
    expect(document.activeElement).toBe(field(host, 'Find'))
  })

  it('counts and marks the matches as the query is typed', () => {
    const { view, host } = mount()
    press(view, 'f', { ctrlKey: true })
    type(field(host, 'Find'), 'cat')
    expect(host.querySelector('.dd-find-count')?.textContent).toBe('1 of 3')
    expect(
      host.querySelectorAll('.dd-find-match').length
    ).toBeGreaterThanOrEqual(3)
  })

  it('moves to the next match on Enter and wraps around', () => {
    const { view, host } = mount()
    press(view, 'f', { ctrlKey: true })
    type(field(host, 'Find'), 'cat')
    field(host, 'Find').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
    expect(host.querySelector('.dd-find-count')?.textContent).toBe('2 of 3')
    for (let i = 0; i < 2; i++)
      field(host, 'Find').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      )
    expect(host.querySelector('.dd-find-count')?.textContent).toBe('1 of 3')
  })

  it('replaces the current match and then all of them', () => {
    const { view, host } = mount()
    press(view, 'f', { ctrlKey: true })
    type(field(host, 'Find'), 'cat')
    type(field(host, 'Replace with'), 'dog')
    host
      .querySelector<HTMLButtonElement>('button[aria-label="Replace"]')!
      .click()
    expect(view.state.doc.textContent).toContain('The dog sat.')
    expect(host.querySelector('.dd-find-count')?.textContent).toBe('1 of 2')
    host
      .querySelector<HTMLButtonElement>('button[aria-label="Replace all"]')!
      .click()
    expect(view.state.doc.textContent).not.toMatch(/cat/i)
    expect(view.state.doc.textContent.match(/dog/g)).toHaveLength(3)
  })

  it('closes on Escape and clears the marks', () => {
    const { view, host } = mount()
    press(view, 'f', { ctrlKey: true })
    type(field(host, 'Find'), 'cat')
    field(host, 'Find').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )
    expect(panel(host)).toBeNull()
    expect(host.querySelectorAll('.dd-find-match')).toHaveLength(0)
  })

  it('offers no replacing when the page cannot be edited', () => {
    const { view, host } = mount(false)
    press(view, 'f', { ctrlKey: true })
    expect(field(host, 'Replace with')).toBeNull()
    expect(host.querySelector('button[aria-label="Replace all"]')).toBeNull()
  })

  it('Ctrl+/ opens it for finding only', () => {
    const { view, host } = mount()
    press(view, '/', { ctrlKey: true })
    expect(panel(host)).not.toBeNull()
    expect(field(host, 'Replace with')).toBeNull()
  })
})
