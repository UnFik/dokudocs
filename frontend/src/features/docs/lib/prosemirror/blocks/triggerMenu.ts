import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from 'prosemirror-state'
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

type MenuState = { pos: number } | null

type TriggerConfig<T extends MenuItem> = {
  trigger: string
  label: string
  enabled: () => boolean
  search: (query: string) => T[] | Promise<T[]>
  /** Runs once the trigger and the query are gone from the page. */
  choose: (view: EditorView, item: T) => void
  /** Also how a command asks for the menu without the trigger key being typed. */
  key: PluginKey<MenuState>
}

/**
 * The trigger and what is typed after it are text of the page, as with the "/"
 * menu: the menu is open while the caret stays at the end of that text.
 */
type MenuSignal = { open: number } | { close: true }

const objectReplacement = '￼'

/** What follows the trigger, or null when the menu should not be showing. */
function queryAt(state: EditorState, pos: number, trigger: string) {
  const { selection, doc } = state
  if (!selection.empty || pos < 0 || selection.from <= pos) return null
  if (selection.from > doc.content.size) return null
  if (!doc.resolve(pos).sameParent(selection.$from)) return null
  const text = doc.textBetween(pos, selection.from, '\n', objectReplacement)
  if (!text.startsWith(trigger)) return null
  const query = text.slice(trigger.length)
  return /[\n￼]/.test(query) ? null : query
}

let count = 0

class TriggerMenu<T extends MenuItem> {
  private readonly root = document.createElement('div')
  private readonly list = document.createElement('ul')
  private items: T[] = []
  private query: string | null = null
  private active = 0
  private closed = false
  private latest = 0
  private pos = 0
  private readonly id = `dd-trigger-${++count}`
  private readonly saved: { role: string | null; label: string | null }

  constructor(
    private readonly view: EditorView,
    private readonly config: TriggerConfig<T>
  ) {
    this.root.className = 'dd-slash'
    this.list.id = `${this.id}-list`
    this.list.setAttribute('role', 'listbox')
    this.list.setAttribute('aria-label', config.label)
    this.root.append(this.list)
    // Keep the caret in the line while the pointer picks an entry.
    this.root.addEventListener('mousedown', (event) => event.preventDefault())

    const dom = view.dom
    this.saved = {
      role: dom.getAttribute('role'),
      label: dom.getAttribute('aria-label'),
    }
    dom.setAttribute('role', 'combobox')
    dom.setAttribute('aria-label', config.label)
    dom.setAttribute('aria-expanded', 'true')
    dom.setAttribute('aria-controls', this.list.id)
    dom.setAttribute('aria-autocomplete', 'list')
    const host = dom.parentElement ?? document.body
    host.append(this.root)
  }

  /** Follows the text after the trigger. */
  update(query: string, pos: number) {
    this.pos = pos
    const host = this.view.dom.parentElement ?? document.body
    const caret = this.view.coordsAtPos(pos)
    const box = host.getBoundingClientRect()
    this.root.style.left = `${Math.max(0, caret.left - box.left)}px`
    this.root.style.top = `${caret.bottom - box.top + 4}px`
    if (query === this.query) return
    this.query = query
    void this.refresh(query)
  }

  private async refresh(query: string) {
    const ticket = ++this.latest
    const found = await this.config.search(query)
    if (this.closed || ticket !== this.latest) return
    this.items = found.slice(0, 12)
    this.active = 0
    // Nothing matches what was typed, so it was not meant for the menu: it
    // stays in the page and typing carries on there (":::" and "@" in an address).
    if (!this.items.length && query) {
      this.close()
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
      this.view.dom.setAttribute(
        'aria-activedescendant',
        `${this.id}-${this.active}`
      )
    else this.view.dom.removeAttribute('aria-activedescendant')
    this.list.children[this.active]?.scrollIntoView?.({ block: 'nearest' })
  }

  /** Arrow keys, Enter and Escape; true when the key was the menu's. */
  onKey(event: KeyboardEvent) {
    if (event.isComposing) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const total = this.items.length
      if (total) {
        this.active =
          (this.active + (event.key === 'ArrowDown' ? 1 : total - 1)) % total
        this.render()
      }
      return true
    }
    if (event.key === 'Enter') {
      this.choose(this.active)
      return true
    }
    if (event.key === 'Escape') {
      this.close()
      return true
    }
    return false
  }

  private choose(index: number) {
    const item = this.items[index]
    if (!item) return
    const { state } = this.view
    // The trigger and the query were only a way to ask: take them out of the page.
    this.view.dispatch(
      state.tr
        .delete(this.pos, state.selection.from)
        .setMeta(this.config.key, { close: true } satisfies MenuSignal)
    )
    this.view.focus()
    this.config.choose(this.view, item)
  }

  /** Closes the menu and leaves what was typed in the page. */
  private close() {
    this.view.dispatch(
      this.view.state.tr.setMeta(this.config.key, {
        close: true,
      } satisfies MenuSignal)
    )
  }

  destroy() {
    this.closed = true
    this.root.remove()
    const dom = this.view.dom
    for (const name of [
      'aria-expanded',
      'aria-controls',
      'aria-autocomplete',
      'aria-activedescendant',
    ])
      dom.removeAttribute(name)
    for (const [name, value] of [
      ['role', this.saved.role],
      ['aria-label', this.saved.label],
    ] as const)
      if (value === null) dom.removeAttribute(name)
      else dom.setAttribute(name, value)
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
  return new Plugin<MenuState>({
    key: config.key,
    // Read by the command that asks for the menu.
    enabled: config.enabled,
    state: {
      init: () => null,
      apply(tr, value, _previous, next) {
        const signal = tr.getMeta(config.key) as MenuSignal | undefined
        if (signal && 'close' in signal) return null
        let pos = value?.pos ?? null
        if (signal) pos = signal.open
        else if (pos !== null && tr.docChanged) pos = tr.mapping.map(pos, -1)
        if (pos === null || queryAt(next, pos, config.trigger) === null)
          return null
        return { pos }
      },
    },
    props: {
      handleKeyDown(view, event) {
        if (menu && config.key.getState(view.state)) {
          if (!menu.onKey(event)) return false
          event.preventDefault()
          return true
        }
        if (
          event.key !== config.trigger ||
          event.isComposing ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          !config.enabled() ||
          !atWordStart(view)
        )
          return false
        event.preventDefault()
        const at = view.state.selection.from
        view.dispatch(
          view.state.tr
            .insertText(config.trigger)
            .setMeta(config.key, { open: at } satisfies MenuSignal)
        )
        return true
      },
    },
    view: () => ({
      update(view) {
        const open = config.key.getState(view.state)
        const query = open
          ? queryAt(view.state, open.pos, config.trigger)
          : null
        if (open && query !== null) {
          menu ??= new TriggerMenu(view, config)
          menu.update(query, open.pos)
        } else if (menu) {
          menu.destroy()
          menu = null
        }
      },
      destroy() {
        menu?.destroy()
        menu = null
      },
    }),
  })
}

const mentionKey = new PluginKey<MenuState>('ddMentionMenu')
const emojiKey = new PluginKey<MenuState>('ddEmojiMenu')

/** Opens the mention list at the caret, as `@` does; false where mentions are not offered. */
export function requestMention(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
) {
  const plugin = mentionKey.get(state)
  if (!plugin || !(plugin.spec as { enabled: () => boolean }).enabled())
    return false
  dispatch?.(
    state.tr.insertText('@').setMeta(mentionKey, {
      open: state.selection.from,
    } satisfies MenuSignal)
  )
  return true
}

/** `@` opens a list of people, pages and projects; the choice becomes a mention. */
export function mentionMenuPlugin(options: {
  enabled: () => boolean
  search: (query: string) => MentionCandidate[] | Promise<MentionCandidate[]>
}) {
  return triggerPlugin<MentionCandidate>({
    trigger: '@',
    label: 'Mention',
    key: mentionKey,
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
    key: emojiKey,
    enabled,
    search: filterEmojis,
    choose(view, item) {
      view.dispatch(view.state.tr.insertText(item.emoji).scrollIntoView())
    },
  })
}
