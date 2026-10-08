import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'

export type MatchRange = { from: number; to: number }
export type FindOptions = { matchCase?: boolean }

/**
 * Every place `query` occurs in the text of the page, in order. A match can run
 * across runs (bold next to plain) of one line, never across lines.
 */
export function findMatches(
  doc: ProseMirrorNode,
  query: string,
  options: FindOptions = {}
): MatchRange[] {
  if (!query) return []
  const needle = options.matchCase ? query : query.toLowerCase()
  const found: MatchRange[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    const pieces: { start: number; pos: number; length: number }[] = []
    let text = ''
    node.descendants((child, offset) => {
      if (!child.isText) return true
      pieces.push({
        start: text.length,
        pos: pos + 1 + offset,
        length: child.text!.length,
      })
      text += child.text
      return false
    })
    const haystack = options.matchCase ? text : text.toLowerCase()
    const at = (offset: number, end: boolean) => {
      const piece = pieces.find(
        (item) => offset >= item.start && offset < item.start + item.length
      )!
      return piece.pos + (offset - piece.start) + (end ? 1 : 0)
    }
    for (
      let from = haystack.indexOf(needle);
      from >= 0;
      from = haystack.indexOf(needle, from + needle.length)
    )
      found.push({
        from: at(from, false),
        to: at(from + needle.length - 1, true),
      })
    return false
  })
  return found
}

type FindState = {
  open: boolean
  /** Whether the replace row is offered: it is not for Ctrl+/ or a page nobody can edit. */
  replaceRow: boolean
  query: string
  active: number
}

const key = new PluginKey<FindState>('findReplace')
type Meta = Partial<FindState>

function matchesOf(state: { doc: ProseMirrorNode }, find: FindState) {
  return find.open ? findMatches(state.doc, find.query) : []
}

/** Find (Ctrl+F) and replace in the page; Ctrl+/ finds only. Marks matches and steps through them. */
export function findReplacePlugin(canReplace: () => boolean = () => true) {
  return new Plugin<FindState>({
    key,
    state: {
      init: () => ({ open: false, replaceRow: false, query: '', active: 0 }),
      apply(tr, value) {
        const meta = tr.getMeta(key) as Meta | undefined
        return meta ? { ...value, ...meta } : value
      },
    },
    props: {
      decorations(state) {
        const find = key.getState(state)!
        const matches = matchesOf(state, find)
        if (!matches.length) return null
        return DecorationSet.create(
          state.doc,
          matches.map((range, index) =>
            Decoration.inline(range.from, range.to, {
              class:
                index === find.active % matches.length
                  ? 'dd-find-match dd-find-active'
                  : 'dd-find-match',
            })
          )
        )
      },
      handleKeyDown(view, event) {
        if (
          !(event.ctrlKey || event.metaKey) ||
          event.altKey ||
          event.isComposing
        )
          return false
        const open = (replaceRow: boolean) => {
          event.preventDefault()
          view.dispatch(view.state.tr.setMeta(key, { open: true, replaceRow }))
          return true
        }
        if (event.key.toLowerCase() === 'f' && !event.shiftKey)
          return open(view.editable && canReplace())
        if (event.key === '/') return open(false)
        return false
      },
    },
    view: (view) => new FindPanel(view),
  })
}

class FindPanel {
  private root: HTMLElement | null = null
  private find!: HTMLInputElement
  private replace: HTMLInputElement | null = null
  private count!: HTMLElement

  constructor(private readonly view: EditorView) {
    this.update()
  }

  private get find_state() {
    return key.getState(this.view.state)!
  }

  private patch(meta: Meta) {
    this.view.dispatch(this.view.state.tr.setMeta(key, meta))
  }

  private matches() {
    return matchesOf(this.view.state, this.find_state)
  }

  private step(direction: 1 | -1) {
    const matches = this.matches()
    if (!matches.length) return
    const active =
      (this.find_state.active + direction + matches.length) % matches.length
    this.patch({ active })
    this.reveal(matches[active]!)
  }

  private reveal(range: MatchRange) {
    const { node } = this.view.domAtPos(range.from)
    const element =
      node.nodeType === 1 ? (node as HTMLElement) : node.parentElement
    element?.scrollIntoView?.({ block: 'center' })
  }

  private replaceCurrent() {
    const matches = this.matches()
    const match = matches[this.find_state.active % (matches.length || 1)]
    if (!match || !this.replace) return
    this.view.dispatch(
      this.view.state.tr.insertText(this.replace.value, match.from, match.to)
    )
  }

  private replaceAll() {
    if (!this.replace) return
    const tr = this.view.state.tr
    for (const match of this.matches().reverse())
      tr.insertText(this.replace.value, match.from, match.to)
    this.view.dispatch(tr)
  }

  private close() {
    this.patch({ open: false, query: '', active: 0 })
    this.view.focus()
  }

  private build() {
    const { replaceRow } = this.find_state
    const root = document.createElement('div')
    root.className = 'dd-find'
    root.setAttribute('role', 'search')
    root.setAttribute('aria-label', 'Find in page')

    const button = (label: string, text: string, onClick: () => void) => {
      const element = document.createElement('button')
      element.type = 'button'
      element.setAttribute('aria-label', label)
      element.title = label
      element.textContent = text
      element.addEventListener('mousedown', (event) => event.preventDefault())
      element.addEventListener('click', onClick)
      return element
    }

    this.find = document.createElement('input')
    this.find.setAttribute('aria-label', 'Find')
    this.find.placeholder = 'Find'
    this.find.addEventListener('input', () =>
      this.patch({ query: this.find.value, active: 0 })
    )
    this.find.addEventListener('keydown', (event) => {
      if (event.isComposing) return
      if (event.key === 'Enter') {
        event.preventDefault()
        this.step(event.shiftKey ? -1 : 1)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        this.close()
      }
    })
    this.count = document.createElement('span')
    this.count.className = 'dd-find-count'
    this.count.setAttribute('aria-live', 'polite')
    root.append(
      this.find,
      this.count,
      button('Previous match', '↑', () => this.step(-1)),
      button('Next match', '↓', () => this.step(1))
    )

    this.replace = null
    if (replaceRow) {
      this.replace = document.createElement('input')
      this.replace.setAttribute('aria-label', 'Replace with')
      this.replace.placeholder = 'Replace with'
      this.replace.addEventListener('keydown', (event) => {
        if (event.isComposing) return
        if (event.key === 'Enter') {
          event.preventDefault()
          this.replaceCurrent()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          this.close()
        }
      })
      root.append(
        this.replace,
        button('Replace', 'Replace', () => this.replaceCurrent()),
        button('Replace all', 'All', () => this.replaceAll())
      )
    }
    root.append(button('Close find', '×', () => this.close()))
    return root
  }

  update() {
    const find = this.find_state
    if (!find.open) {
      this.root?.remove()
      this.root = null
      return
    }
    if (!this.root || (this.replace === null) === find.replaceRow) {
      this.root?.remove()
      this.root = this.build()
      const host = this.view.dom.parentElement ?? document.body
      host.classList.add('dd-host')
      host.append(this.root)
      this.find.value = find.query
      this.find.focus()
    }
    const matches = this.matches()
    this.count.textContent = !find.query
      ? ''
      : matches.length
        ? `${(find.active % matches.length) + 1} of ${matches.length}`
        : 'No matches'
  }

  destroy() {
    this.root?.remove()
  }
}
