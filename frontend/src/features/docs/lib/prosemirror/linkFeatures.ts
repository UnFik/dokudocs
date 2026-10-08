import { Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { documentBodySchema } from './documentBody'
import { normalizeLinkTarget } from './inlineMarks'

const link = documentBodySchema.marks.link!

/** One URL and nothing else, with a scheme a link may have. */
/** A 16px line icon from path data, drawn in the text color. */
function icon(paths: string[]) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }
  return svg
}

function pastedURL(text: string) {
  const trimmed = text.trim()
  if (!/^(https?:\/\/|mailto:)\S+$/i.test(trimmed)) return null
  return normalizeLinkTarget(trimmed)
}

export type LinkFeaturesOptions = {
  /** Off while the page is read only or in Suggest mode: both change text another way. */
  enabled: () => boolean
  /** The title of a page a link goes to, when it is a page of this app. */
  resolveTitle?: (href: string) => Promise<string | null>
}

/**
 * Pasting a URL over selected text links it; pasting one into an empty spot
 * inserts it as a link with a way to turn it into plain text. Hovering a link
 * shows where it goes, with Open and Copy.
 */
export function linkFeaturesPlugin(options: LinkFeaturesOptions) {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        if (!options.enabled() || !view.editable) return false
        const url = pastedURL(event.clipboardData?.getData('text/plain') ?? '')
        if (!url) return false
        const { from, to, empty } = view.state.selection
        event.preventDefault()
        if (!empty) {
          view.dispatch(
            view.state.tr
              .removeMark(from, to, link)
              .addMark(from, to, link.create({ href: url }))
              .scrollIntoView()
          )
          return true
        }
        const text = documentBodySchema.text(url, [link.create({ href: url })])
        view.dispatch(view.state.tr.insert(from, text).scrollIntoView())
        showPasteMenu(view, from, url)
        return true
      },
    },
    view: (view) => new LinkHover(view, options),
  })
}

/** The pasted link in the page now (typing around it may have split the run it went into). */
function pastedRange(view: EditorView, near: number, url: string) {
  let found: { from: number; to: number } | null = null
  view.state.doc.descendants((node, pos) => {
    if (
      node.isText &&
      node.text === url &&
      node.marks.some(
        (mark) => mark.type === link && mark.attrs.href === url
      ) &&
      (!found || Math.abs(pos - near) < Math.abs(found.from - near))
    )
      found = { from: pos, to: pos + node.nodeSize }
    return true
  })
  return found as { from: number; to: number } | null
}

function showPasteMenu(view: EditorView, from: number, url: string) {
  const to = from + url.length
  const host = view.dom.parentElement ?? document.body
  host.querySelector('.dd-paste-menu')?.remove()
  const menu = document.createElement('div')
  menu.className = 'dd-paste-menu'
  menu.setAttribute('role', 'status')
  menu.append('Pasted as a link ')
  const plain = document.createElement('button')
  plain.type = 'button'
  plain.setAttribute('aria-label', 'Paste as plain text')
  plain.textContent = 'Plain text'
  plain.addEventListener('mousedown', (event) => event.preventDefault())
  plain.addEventListener('click', () => {
    const range = pastedRange(view, from, url)
    if (range)
      view.dispatch(view.state.tr.removeMark(range.from, range.to, link))
    menu.remove()
    view.focus()
  })
  const dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.setAttribute('aria-label', 'Keep the link')
  dismiss.textContent = 'Keep'
  dismiss.addEventListener('mousedown', (event) => event.preventDefault())
  dismiss.addEventListener('click', () => menu.remove())
  menu.append(plain, dismiss)
  host.classList.add('dd-host')
  host.append(menu)
  const caret = view.coordsAtPos(to)
  const box = host.getBoundingClientRect()
  menu.style.left = `${Math.max(0, caret.left - box.left)}px`
  menu.style.top = `${caret.bottom - box.top + 6}px`
  setTimeout(() => menu.remove(), 8000)
}

class LinkHover {
  private card: HTMLElement | null = null
  private hideTimer: ReturnType<typeof setTimeout> | undefined
  private readonly over = (event: MouseEvent) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-link-href]'
    )
    if (!target || !this.view.dom.contains(target)) return
    clearTimeout(this.hideTimer)
    this.show(target)
  }
  private readonly out = (event: MouseEvent) => {
    if ((event.target as HTMLElement | null)?.closest('[data-link-href]'))
      this.scheduleHide()
  }

  constructor(
    private readonly view: EditorView,
    private readonly options: LinkFeaturesOptions
  ) {
    view.dom.addEventListener('mouseover', this.over)
    view.dom.addEventListener('mouseout', this.out)
  }

  private scheduleHide() {
    clearTimeout(this.hideTimer)
    this.hideTimer = setTimeout(() => this.hide(), 250)
  }

  private hide() {
    this.card?.remove()
    this.card = null
  }

  private show(target: HTMLElement) {
    const href = target.dataset.linkHref ?? ''
    this.hide()
    const host = this.view.dom.parentElement ?? document.body
    host.classList.add('dd-host')
    const card = document.createElement('div')
    card.className = 'dd-link-card'
    card.addEventListener('mouseenter', () => clearTimeout(this.hideTimer))
    card.addEventListener('mouseleave', () => this.scheduleHide())

    const title = document.createElement('span')
    title.className = 'dd-link-title'
    const address = document.createElement('span')
    address.className = 'dd-link-address'
    address.textContent = href
    const open = document.createElement('a')
    open.setAttribute('aria-label', 'Open link')
    open.href = href
    open.target = '_blank'
    open.rel = 'noopener noreferrer'
    open.dataset.tip = 'Open link'
    open.append(
      icon([
        'M15 3h6v6',
        'M10 14 21 3',
        'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
      ])
    )
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.setAttribute('aria-label', 'Copy link')
    copy.dataset.tip = 'Copy link'
    copy.append(
      icon([
        'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
        'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z',
      ])
    )
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(new URL(href, location.href).href)
      // The popover says it worked, until the pointer leaves.
      copy.dataset.tip = 'Copied'
      setTimeout(() => (copy.dataset.tip = 'Copy link'), 1500)
    })
    card.append(title, address, open, copy)
    host.append(card)
    this.card = card
    const box = host.getBoundingClientRect()
    const rect = target.getBoundingClientRect()
    card.style.left = `${Math.max(0, rect.left - box.left)}px`
    card.style.top = `${rect.bottom - box.top + 4}px`

    if (this.options.resolveTitle && href.startsWith('/'))
      void this.options.resolveTitle(href).then((name) => {
        if (name && this.card === card) title.textContent = name
      })
  }

  destroy() {
    clearTimeout(this.hideTimer)
    this.view.dom.removeEventListener('mouseover', this.over)
    this.view.dom.removeEventListener('mouseout', this.out)
    this.hide()
    this.view.dom.parentElement?.querySelector('.dd-paste-menu')?.remove()
  }
}
