import { Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import emojis from '../../muya/config/emojis'
import { documentBodySchema } from '../documentBody'
import { insertInline } from './insertBlock'

export interface MenuItem {
  id: string
  label: string
  hint: string
}

export interface MentionCandidate {
  kind: 'person' | 'document' | 'project'
  id: string
  label: string
  hint: string
}

type TriggerConfig<T extends MenuItem> = {
  trigger: string
  label: string
  enabled: () => boolean
  search: (query: string) => T[] | Promise<T[]>
  choose: (view: EditorView, item: T) => void
}

let count = 0

class TriggerMenu<T extends MenuItem> {
  private readonly root = document.createElement('div')
  private readonly input = document.createElement('input')
  private readonly list = document.createElement('ul')
  private items: T[] = []
  private active = 0
  private closed = false
  private latest = 0
  private readonly id = `dd-trigger-${++count}`

  constructor(
    private readonly view: EditorView,
    private readonly config: TriggerConfig<T>,
    private readonly onClose: () => void
  ) {
    this.root.className = 'dd-slash'
    this.input.className = 'dd-slash-input'
    this.input.setAttribute('role', 'combobox')
    this.input.setAttribute('aria-label', config.label)
    this.input.setAttribute('aria-expanded', 'true')
    this.input.setAttribute('aria-controls', `${this.id}-list`)
    this.input.setAttribute('aria-autocomplete', 'list')
    this.input.placeholder = `${config.label}…`
    this.list.id = `${this.id}-list`
    this.list.setAttribute('role', 'listbox')
    this.list.setAttribute('aria-label', config.label)
    this.root.append(this.input, this.list)
    this.input.addEventListener('input', () => void this.refresh())
    this.input.addEventListener('keydown', (event) => this.onKey(event))
    this.input.addEventListener('blur', () => this.close(false))

    const host = view.dom.parentElement ?? document.body
    host.append(this.root)
    const caret = view.coordsAtPos(view.state.selection.from)
    const box = host.getBoundingClientRect()
    this.root.style.left = `${Math.max(0, caret.left - box.left)}px`
    this.root.style.top = `${caret.bottom - box.top + 4}px`
    this.input.focus()
    void this.refresh()
  }

  private async refresh() {
    const ticket = ++this.latest
    const found = await this.config.search(this.input.value)
    if (this.closed || ticket !== this.latest) return
    this.items = found.slice(0, 12)
    this.active = 0
    // Nothing matches what was typed, so it was not meant for the menu: write it
    // into the page and carry on typing there (":::" and "@" in an address).
    if (!this.items.length && this.input.value) {
      const typed = this.config.trigger + this.input.value
      this.close(true)
      this.view.dispatch(this.view.state.tr.insertText(typed))
      return
    }
    this.render()
  }

  private render() {
    this.list.replaceChildren()
    this.items.forEach((item, index) => {
      const option = document.createElement('li')
      option.id = `${this.id}-${index}`
      option.setAttribute('role', 'option')
      option.setAttribute('aria-selected', String(index === this.active))
      option.className = 'dd-slash-option'
      const label = document.createElement('span')
      label.textContent = item.label
      const hint = document.createElement('span')
      hint.className = 'dd-slash-hint'
      hint.textContent = item.hint
      option.append(label, hint)
      option.addEventListener('mousedown', (event) => {
        event.preventDefault()
        this.choose(index)
      })
      this.list.append(option)
    })
    if (!this.items.length) {
      const empty = document.createElement('li')
      empty.className = 'dd-slash-empty'
      empty.textContent = 'Nothing matches.'
      this.list.append(empty)
    }
    if (this.items[this.active])
      this.input.setAttribute(
        'aria-activedescendant',
        `${this.id}-${this.active}`
      )
    else this.input.removeAttribute('aria-activedescendant')
  }

  private onKey(event: KeyboardEvent) {
    if (event.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const total = this.items.length
      if (!total) return
      this.active =
        (this.active + (event.key === 'ArrowDown' ? 1 : total - 1)) % total
      this.render()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      this.choose(this.active)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      this.close(true)
    }
  }

  private choose(index: number) {
    const item = this.items[index]
    if (!item) return
    this.close(true)
    this.config.choose(this.view, item)
  }

  close(refocus: boolean) {
    if (this.closed) return
    this.closed = true
    this.root.remove()
    this.onClose()
    if (refocus) this.view.focus()
  }
}

/** True when the caret sits where a word could start: after a space, or at the start of a line. */
function atWordStart(view: EditorView) {
  const { $from, empty } = view.state.selection
  if (!empty || !view.editable) return false
  if ($from.parent.type.spec.code || $from.parent.type.name === 'code_block')
    return false
  const before = $from.parent.textBetween(0, $from.parentOffset, '', '￼')
  return before === '' || /[\s￼]$/.test(before)
}

function triggerPlugin<T extends MenuItem>(config: TriggerConfig<T>) {
  let menu: TriggerMenu<T> | null = null
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (
          event.key !== config.trigger ||
          event.isComposing ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          menu ||
          !config.enabled() ||
          !atWordStart(view)
        )
          return false
        event.preventDefault()
        menu = new TriggerMenu(view, config, () => {
          menu = null
        })
        return true
      },
    },
    view: () => ({
      destroy() {
        menu?.close(false)
      },
    }),
  })
}

/** `@` opens a list of people, pages and projects; the choice becomes a mention. */
export function mentionMenuPlugin(options: {
  enabled: () => boolean
  search: (query: string) => MentionCandidate[] | Promise<MentionCandidate[]>
}) {
  return triggerPlugin<MentionCandidate>({
    trigger: '@',
    label: 'Mention',
    enabled: options.enabled,
    search: options.search,
    choose(view, item) {
      const mention = documentBodySchema.nodes.mention!.create({
        nodeID: null,
        bodyAttributes: JSON.stringify({
          kind: item.kind,
          id: item.id,
          label: item.label,
        }),
        bodyContent: '',
      })
      const inserted = insertInline(view.state, mention)
      if (inserted) view.dispatch(inserted.tr.scrollIntoView())
    },
  })
}

export interface EmojiItem extends MenuItem {
  emoji: string
}

const emojiItems: EmojiItem[] = emojis.map((entry) => ({
  id: entry.aliases[0] ?? entry.description,
  label: `${entry.emoji} ${entry.aliases[0] ?? entry.description}`,
  hint: entry.description,
  emoji: entry.emoji,
  search: [entry.description, ...entry.aliases, ...entry.tags]
    .join(' ')
    .toLowerCase(),
})) as (EmojiItem & { search: string })[]

export function filterEmojis(query: string): EmojiItem[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return emojiItems.slice(0, 12)
  return (emojiItems as (EmojiItem & { search: string })[]).filter((item) =>
    item.search.includes(needle)
  )
}

/** `:` opens an emoji picker; the choice is written as plain text. */
export function emojiMenuPlugin(enabled: () => boolean) {
  return triggerPlugin<EmojiItem>({
    trigger: ':',
    label: 'Emoji',
    enabled,
    search: filterEmojis,
    choose(view, item) {
      view.dispatch(view.state.tr.insertText(item.emoji).scrollIntoView())
    },
  })
}
