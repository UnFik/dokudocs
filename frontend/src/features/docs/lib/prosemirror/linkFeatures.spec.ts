import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { bodyBuilder, bodyOf } from './blocks/testSupport'
import { documentBodyToProseMirror } from './documentBody'
import { runStart } from './editorTestKit'
import { linkFeaturesPlugin } from './linkFeatures'
import { prepareBodyTransaction } from './prepareBodyTransaction'

const views: EditorView[] = []
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy())
  document.body.replaceChildren()
})

function mount(
  text: string,
  options: {
    enabled?: boolean
    resolveTitle?: (href: string) => Promise<string | null>
    linked?: string
  } = {}
) {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  const p = b.add(root, 'paragraph')
  b.add(p, 'run', text, options.linked ? { href: options.linked } : {})
  const host = document.createElement('div')
  document.body.append(host)
  const view: EditorView = new EditorView(host, {
    state: EditorState.create({
      doc: documentBodyToProseMirror(b.nodes),
      plugins: [
        linkFeaturesPlugin({
          enabled: () => options.enabled ?? true,
          resolveTitle: options.resolveTitle,
        }),
      ],
    }),
    dispatchTransaction(tr) {
      const next = tr.docChanged ? prepareBodyTransaction(view.state, tr) : tr
      view.updateState(view.state.apply(next))
    },
  })
  views.push(view)
  return { view, host }
}

function paste(view: EditorView, text: string) {
  const data = new DataTransfer()
  data.setData('text/plain', text)
  const event = new ClipboardEvent('paste', {
    clipboardData: data,
    bubbles: true,
    cancelable: true,
  })
  view.dom.dispatchEvent(event)
  return event
}

function select(view: EditorView, from: number, to: number) {
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to))
  )
}

const linkOf = (view: EditorView) =>
  bodyOf(view.state.doc).find(
    (node) => node.type === 'run' && typeof node.attributes.href === 'string'
  )

describe('pasting a link', () => {
  it('over selected text makes that text a link', () => {
    const { view } = mount('read the docs')
    const start = runStart(view.state.doc, 'read the docs')
    select(view, start + 9, start + 13)
    const event = paste(view, 'https://example.com/docs')
    expect(event.defaultPrevented).toBe(true)
    expect(linkOf(view)).toMatchObject({
      content: 'docs',
      attributes: { href: 'https://example.com/docs' },
    })
    expect(view.state.doc.textContent).toBe('read the docs')
  })

  it('in an empty spot is inserted as a link, with a way to make it plain text', () => {
    const { view, host } = mount('see ')
    const caret = runStart(view.state.doc, 'see ') + 4
    select(view, caret, caret)
    paste(view, 'https://example.com')
    expect(linkOf(view)).toMatchObject({ content: 'https://example.com' })
    const action = host.querySelector<HTMLButtonElement>(
      '.dd-paste-menu button[aria-label="Paste as plain text"]'
    )!
    expect(action).not.toBeNull()
    action.click()
    expect(linkOf(view)).toBeUndefined()
    expect(view.state.doc.textContent).toBe('see https://example.com')
    expect(host.querySelector('.dd-paste-menu')).toBeNull()
  })

  it('leaves other text to the editor', () => {
    const { view } = mount('plain')
    const caret = runStart(view.state.doc, 'plain') + 2
    select(view, caret, caret)
    paste(view, 'not a link')
    expect(linkOf(view)).toBeUndefined()
  })

  it('leaves a link with something other than http or mailto to the editor', () => {
    const { view } = mount('plain')
    const caret = runStart(view.state.doc, 'plain') + 2
    select(view, caret, caret)
    paste(view, 'javascript:alert(1)')
    expect(linkOf(view)).toBeUndefined()
  })

  it('does nothing while the editor is not enabled (read only or Suggest mode)', () => {
    const { view } = mount('plain', { enabled: false })
    const caret = runStart(view.state.doc, 'plain') + 2
    select(view, caret, caret)
    paste(view, 'https://example.com')
    expect(linkOf(view)).toBeUndefined()
  })
})

describe('hovering a link', () => {
  const hover = (host: HTMLElement) =>
    host
      .querySelector<HTMLElement>('[data-link-href]')!
      .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))

  it('shows where it goes, with Open and Copy', () => {
    const { host } = mount('a link', { linked: 'https://example.com/x' })
    hover(host)
    const card = host.querySelector<HTMLElement>('.dd-link-card')!
    expect(card.textContent).toContain('https://example.com/x')
    const open = card.querySelector<HTMLAnchorElement>(
      'a[aria-label="Open link"]'
    )!
    expect(open.getAttribute('href')).toBe('https://example.com/x')
    expect(open.getAttribute('target')).toBe('_blank')
    expect(open.getAttribute('rel')).toBe('noopener noreferrer')
    expect(card.querySelector('button[aria-label="Copy link"]')).not.toBeNull()
  })

  it('offers Open and Copy as icons, each naming itself in a popover', () => {
    const { host } = mount('a link', { linked: 'https://example.com/x' })
    hover(host)
    const card = host.querySelector<HTMLElement>('.dd-link-card')!
    const open = card.querySelector<HTMLElement>('a[aria-label="Open link"]')!
    const copy = card.querySelector<HTMLElement>(
      'button[aria-label="Copy link"]'
    )!
    for (const control of [open, copy]) {
      expect(control.querySelector('svg')).not.toBeNull()
      expect(control.textContent).toBe('')
    }
    expect(open.dataset.tip).toBe('Open link')
    expect(copy.dataset.tip).toBe('Copy link')
  })

  it('shows the title of a page link once it is known', async () => {
    const { host } = mount('a page', {
      linked: '/docs/11111111-1111-4111-8111-111111111111',
      resolveTitle: async () => 'Launch plan',
    })
    hover(host)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(host.querySelector('.dd-link-card')?.textContent).toContain(
      'Launch plan'
    )
  })

  it('goes away when the pointer leaves', async () => {
    const { host } = mount('a link', { linked: 'https://example.com' })
    hover(host)
    host
      .querySelector('[data-link-href]')!
      .dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(host.querySelector('.dd-link-card')).toBeNull()
  })
})
