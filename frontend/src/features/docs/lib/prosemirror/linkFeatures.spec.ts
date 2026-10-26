import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bodyBuilder, bodyOf } from './blocks/testSupport'
import { documentBodyToProseMirror } from './documentBody'
import { runStart } from './editorTestKit'
import { linkFeaturesPlugin, type LinkFeaturesOptions } from './linkFeatures'
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
    resolvePreview?: LinkFeaturesOptions['resolvePreview']
    linked?: string
    mention?: { kind: string; id: string; label: string }
  } = {}
) {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  const p = b.add(root, 'paragraph')
  b.add(p, 'run', text, options.linked ? { href: options.linked } : {})
  if (options.mention) b.add(p, 'mention', '', options.mention)
  const host = document.createElement('div')
  document.body.append(host)
  const view: EditorView = new EditorView(host, {
    state: EditorState.create({
      doc: documentBodyToProseMirror(b.nodes),
      plugins: [
        linkFeaturesPlugin({
          enabled: () => options.enabled ?? true,
          resolveTitle: options.resolveTitle,
          resolvePreview: options.resolvePreview,
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

describe('mention chips', () => {
  const page = {
    kind: 'document',
    id: '11111111-1111-4111-8111-111111111111',
    label: 'Launch plan',
  }
  const person = { kind: 'person', id: 'u-1', label: 'Rina Putri' }
  const chip = (host: HTMLElement) =>
    host.querySelector<HTMLElement>('.dd-mention')!
  const hover = (host: HTMLElement) =>
    chip(host).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))

  it('open a page in a new tab when clicked', () => {
    const { host } = mount('see ', { mention: page })
    const opened: unknown[][] = []
    const original = window.open
    window.open = ((...args: unknown[]) => void opened.push(args)) as never
    try {
      const click = new MouseEvent('click', { bubbles: true, cancelable: true })
      chip(host).dispatchEvent(click)
      expect(click.defaultPrevented).toBe(true)
    } finally {
      window.open = original
    }
    expect(opened).toEqual([[`/docs/${page.id}`, '_blank', 'noopener']])
  })

  it('do nothing on click when they are a person', () => {
    const { host } = mount('see ', { mention: person })
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    chip(host).dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
  })

  it('show a page card with its title, Open and Copy on hover', async () => {
    const { host } = mount('see ', {
      mention: page,
      resolveTitle: async () => 'Launch plan v2',
    })
    hover(host)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const card = host.querySelector<HTMLElement>('.dd-link-card')!
    expect(card.textContent).toContain('Launch plan v2')
    const open = card.querySelector<HTMLAnchorElement>(
      'a[aria-label="Open link"]'
    )!
    expect(open.getAttribute('href')).toBe(`/docs/${page.id}`)
    expect(open.getAttribute('target')).toBe('_blank')
    expect(card.querySelector('button[aria-label="Copy link"]')).not.toBeNull()
  })

  it('show a person card with the name only on hover', () => {
    const { host } = mount('see ', { mention: person })
    hover(host)
    const card = host.querySelector<HTMLElement>('.dd-link-card')!
    expect(card.textContent).toContain('Rina Putri')
    expect(card.textContent).toContain('Person')
    expect(card.querySelector('a, button')).toBeNull()
  })
})

describe('hover previews, fetched on demand', () => {
  const pageID = '11111111-1111-4111-8111-111111111111'
  const page = { kind: 'document', id: pageID, label: 'Launch plan' }
  const person = { kind: 'person', id: 'u-1', label: 'Rina Putri' }
  const wait = () => new Promise((resolve) => setTimeout(resolve, 20))
  const hover = (host: HTMLElement, selector = '.dd-mention') =>
    host
      .querySelector<HTMLElement>(selector)!
      .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  const leave = (host: HTMLElement) =>
    host
      .querySelector<HTMLElement>('.dd-mention')!
      .dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))

  it('asks nothing until a chip is hovered, and once per page', async () => {
    const asked: unknown[] = []
    const { host } = mount('see ', {
      mention: page,
      resolvePreview: async (target) => {
        asked.push(target)
        return { kind: 'document', title: 'Launch plan', type: 'markdown' }
      },
    })
    expect(asked).toEqual([])
    hover(host)
    await wait()
    leave(host)
    hover(host)
    await wait()
    expect(asked).toEqual([{ kind: 'document', id: pageID }])
  })

  it('shows the excerpt, the author and when the page was changed', async () => {
    const { host } = mount('see ', {
      mention: page,
      resolvePreview: async () => ({
        kind: 'document',
        title: 'Launch plan',
        type: 'markdown',
        excerpt: 'Ship the new editor',
        authorName: 'Rina Putri',
        updatedAt: '2026-10-20T08:00:00Z',
      }),
    })
    hover(host)
    await wait()
    const card = host.querySelector<HTMLElement>('.dd-link-card')!
    expect(card.querySelector('.dd-link-title')?.textContent).toBe(
      'Launch plan'
    )
    expect(card.querySelector('.dd-link-excerpt')?.textContent).toBe(
      'Ship the new editor'
    )
    expect(card.textContent).toContain('Rina Putri')
  })

  it('shows the thumbnail of a drawing with its scripts removed', async () => {
    const { host } = mount('see ', {
      mention: page,
      resolvePreview: async () => ({
        kind: 'document',
        title: 'Flow',
        type: 'mermaid',
        thumbnail:
          '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/><script>alert(1)</script></svg>',
      }),
    })
    hover(host)
    await wait()
    const thumb = host.querySelector<HTMLElement>('.dd-link-thumbnail')!
    expect(thumb.querySelector('svg rect')).not.toBeNull()
    expect(thumb.querySelector('script')).toBeNull()
  })

  it('shows the dark thumbnail in the dark theme', async () => {
    document.documentElement.classList.add('dark')
    try {
      const { host } = mount('see ', {
        mention: page,
        resolvePreview: async () => ({
          kind: 'document',
          title: 'Flow',
          type: 'mermaid',
          thumbnail: '<svg xmlns="http://www.w3.org/2000/svg" id="light"/>',
          thumbnailDark: '<svg xmlns="http://www.w3.org/2000/svg" id="dark"/>',
        }),
      })
      hover(host)
      await wait()
      expect(host.querySelector('.dd-link-thumbnail svg')?.id).toBe('dark')
    } finally {
      document.documentElement.classList.remove('dark')
    }
  })

  it('shows who a person is: avatar, name, email, role and bio', async () => {
    const asked: unknown[] = []
    const { host } = mount('see ', {
      mention: person,
      resolvePreview: async (target) => {
        asked.push(target)
        return {
          kind: 'person',
          name: 'Rina Putri',
          email: 'rina@example.com',
          role: 'owner',
          bio: 'Writes the launch plan',
          avatarUrl: 'https://example.com/rina.png',
        }
      },
    })
    hover(host)
    await wait()
    const card = host.querySelector<HTMLElement>('.dd-link-card')!
    expect(asked).toEqual([{ kind: 'person', id: 'u-1' }])
    expect(card.textContent).toContain('rina@example.com')
    expect(card.textContent).toContain('owner')
    expect(card.textContent).toContain('Writes the launch plan')
    expect(card.querySelector('.dd-link-avatar img')?.getAttribute('src')).toBe(
      'https://example.com/rina.png'
    )
  })

  it('is also shown for a link to a page of the app', async () => {
    const { host } = mount('a page', {
      linked: `/docs/${pageID}`,
      resolvePreview: async () => ({
        kind: 'document',
        title: 'Launch plan',
        type: 'markdown',
        excerpt: 'Ship the new editor',
      }),
    })
    hover(host, '[data-link-href]')
    await wait()
    expect(host.querySelector('.dd-link-excerpt')?.textContent).toBe(
      'Ship the new editor'
    )
  })

  it('keeps the basic card when the preview cannot be loaded', async () => {
    const { host } = mount('see ', {
      mention: page,
      resolvePreview: async () => {
        throw new Error('offline')
      },
    })
    hover(host)
    await wait()
    const card = host.querySelector<HTMLElement>('.dd-link-card')!
    expect(card.textContent).toContain('Launch plan')
    expect(card.querySelector('a[aria-label="Open link"]')).not.toBeNull()
  })

  it('draws a page without a stored thumbnail from the start of its Markdown', async () => {
    const { host } = mount('see ', {
      mention: page,
      resolvePreview: async () => ({
        kind: 'document',
        title: 'Launch plan',
        type: 'markdown',
        excerpt: 'Launch plan Ship it',
        previewSource:
          '# Launch plan\n\nShip **it**.<script>alert(1)</script><img src=x onerror=alert(1)>',
      }),
    })
    hover(host)
    await wait()
    const thumb = host.querySelector<HTMLElement>('.dd-link-thumbnail')!
    expect(thumb.querySelector('h1')?.textContent).toBe('Launch plan')
    expect(thumb.querySelector('strong')?.textContent).toBe('it')
    expect(thumb.querySelector('script')).toBeNull()
    expect(thumb.querySelector('[onerror]')).toBeNull()
    // The thumbnail already shows the text, so the excerpt is not repeated.
    expect(host.querySelector('.dd-link-excerpt')).toBeNull()
  })

  it('draws a diagram without a stored thumbnail from its source', async () => {
    const { host } = mount('see ', {
      mention: page,
      resolvePreview: async () => ({
        kind: 'document',
        title: 'Schema',
        type: 'dbdiagram',
        previewSource: 'Table users {\n  id int [pk]\n  name varchar\n}',
      }),
    })
    hover(host)
    // The drawing code is loaded on first use, which takes a moment.
    await vi.waitFor(
      () => expect(host.querySelector('.dd-link-thumbnail svg')).not.toBeNull(),
      { timeout: 8000 }
    )
  })

  it('gives a person without a picture their initials', async () => {
    const { host } = mount('see ', {
      mention: person,
      resolvePreview: async () => ({
        kind: 'person',
        name: 'System Administrator',
        email: 'admin@example.com',
        role: 'owner',
      }),
    })
    hover(host)
    await wait()
    const card = host.querySelector<HTMLElement>('.dd-link-card')!
    // A person's card is laid out compactly, not as one long row.
    expect(card.classList.contains('dd-link-card-person')).toBe(true)
    // The role sits beside the email, not on a row of its own.
    expect(card.querySelector('.dd-link-address')?.textContent).toBe(
      'admin@example.com (owner)'
    )
    expect(card.querySelector('.dd-link-address .dd-link-role')).not.toBeNull()
    const avatar = host.querySelector<HTMLElement>('.dd-link-avatar')!
    expect(avatar.textContent).toBe('SA')
    expect(avatar.querySelector('img')).toBeNull()
  })

  it('does not fill a card the pointer has already left', async () => {
    let finish: (value: null) => void = () => {}
    const { host } = mount('see ', {
      mention: page,
      resolvePreview: () =>
        new Promise((resolve) => {
          finish = resolve as (value: null) => void
        }),
    })
    hover(host)
    leave(host)
    await new Promise((resolve) => setTimeout(resolve, 400))
    finish(null)
    await wait()
    expect(host.querySelector('.dd-link-card')).toBeNull()
  })
})
