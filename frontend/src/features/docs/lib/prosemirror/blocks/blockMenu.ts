import type { Node as ProseMirrorNode, ResolvedPos } from 'prosemirror-model'
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
} from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import { documentBodySchema } from '../documentBody'
import { blockMenuMeta, type BlockMenuMeta } from '../trackBlockInsert'
import { blockIcon } from './blockIcons'
import { createNode, insertBlock, type Command } from './insertBlock'
import {
  insertDiagram,
  insertInlineMath,
  insertMathBlock,
} from './mediaCommands'
import { insertTable } from './tableCommands'
import { requestImageForm } from './toolbar'
import { requestFilePicker } from './uploads'

export interface BlockItem {
  id: string
  label: string
  hint: string
  keywords: string[]
  command: Command
  /** A heading entry only sets the level of the paragraph it is used in. */
  headingLevel?: number
}

const paragraph = () => createNode('paragraph', {})
const listItem = (type = 'list_item', attrs: Record<string, unknown> = {}) =>
  createNode(type, attrs, [paragraph()])

export const blockItems: BlockItem[] = [
  ...[1, 2, 3, 4].map((level) => ({
    id: `heading-${level}`,
    label: `Heading ${level}`,
    hint: '#'.repeat(level),
    keywords: ['heading', 'title', 'h' + level],
    headingLevel: level,
    command: insertBlock(createNode('atx_heading', { level })),
  })),
  {
    id: 'bullet-list',
    label: 'Bulleted list',
    hint: '-',
    keywords: ['list', 'bullet', 'ul'],
    command: insertBlock(
      createNode('bullet_list', { marker: '-', loose: false }, [listItem()])
    ),
  },
  {
    id: 'ordered-list',
    label: 'Numbered list',
    hint: '1.',
    keywords: ['list', 'number', 'ordered', 'ol'],
    command: insertBlock(
      createNode('order_list', { start: 1, loose: false, delimiter: '.' }, [
        listItem(),
      ])
    ),
  },
  {
    id: 'task-list',
    label: 'Task list',
    hint: '[ ]',
    keywords: ['todo', 'task', 'checkbox'],
    command: insertBlock(
      createNode('task_list', { marker: '-', loose: false }, [
        listItem('task_list_item', { checked: false }),
      ])
    ),
  },
  {
    id: 'quote',
    label: 'Quote',
    hint: '>',
    keywords: ['quote', 'blockquote'],
    command: insertBlock(createNode('block_quote', {}, [paragraph()])),
  },
  {
    id: 'code-block',
    label: 'Code block',
    hint: '```',
    keywords: ['code', 'fence', 'pre'],
    command: insertBlock(
      createNode('code_block', { type: 'fenced', lang: '' })
    ),
  },
  {
    id: 'table',
    label: 'Table',
    hint: '3x3',
    keywords: ['table', 'grid'],
    command: insertTable(3, 3),
  },
  {
    id: 'divider',
    label: 'Divider',
    hint: '---',
    keywords: ['divider', 'rule', 'hr', 'line'],
    command: (state, dispatch) =>
      insertBlock(
        documentBodySchema.nodes.thematic_break!.create({
          nodeID: null,
          bodyAttributes: '{}',
          bodyContent: '---',
        })
      )(state, dispatch),
  },
  {
    id: 'math-block',
    label: 'Math block',
    hint: '$$',
    keywords: ['math', 'latex', 'katex', 'formula'],
    command: insertMathBlock,
  },
  {
    id: 'mermaid',
    label: 'Mermaid diagram',
    hint: 'mermaid',
    keywords: ['diagram', 'mermaid', 'flowchart', 'chart'],
    command: insertDiagram('mermaid'),
  },
]

const notice = (variant: string, label: string): BlockItem => ({
  id: `notice-${variant}`,
  label: `${label} notice`,
  hint: ':::' + variant,
  keywords: ['notice', 'callout', 'alert', 'box', variant],
  command: insertBlock(createNode('notice', { variant }, [paragraph()])),
})

blockItems.push(
  notice('info', 'Info'),
  notice('success', 'Success'),
  notice('warning', 'Warning'),
  notice('tip', 'Tip'),
  {
    id: 'toggle',
    label: 'Toggle',
    hint: '+++',
    keywords: ['toggle', 'fold', 'collapse', 'details', 'accordion'],
    command: insertBlock(createNode('toggle', {}, [paragraph(), paragraph()])),
  },
  {
    id: 'toggle-heading',
    label: 'Toggle heading',
    hint: '+++ #',
    keywords: ['toggle', 'heading', 'fold', 'collapse', 'section'],
    command: insertBlock(
      createNode('toggle', {}, [
        createNode('atx_heading', { level: 2 }),
        paragraph(),
      ])
    ),
  },
  {
    id: 'image-address',
    label: 'Image from address',
    hint: 'url',
    keywords: ['image', 'picture', 'url', 'link', 'address'],
    command: requestImageForm,
  },
  {
    id: 'inline-math',
    label: 'Inline math',
    hint: '$x$',
    keywords: ['inline', 'math', 'latex', 'formula'],
    command: insertInlineMath,
  },
  {
    id: 'upload-file',
    label: 'Image or file',
    hint: 'upload',
    keywords: [
      'image',
      'picture',
      'photo',
      'video',
      'file',
      'pdf',
      'upload',
      'attachment',
    ],
    command: requestFilePicker,
  },
  {
    id: 'page-break',
    label: 'Page break',
    hint: '---',
    keywords: ['page', 'break', 'print', 'pagebreak'],
    command: insertBlock(createNode('page_break', {})),
  },
  {
    id: 'current-date',
    label: 'Current date',
    hint: 'today',
    keywords: ['date', 'today', 'now', 'time'],
    command: (state, dispatch) => {
      if (!state.selection.empty) return false
      dispatch?.(
        state.tr.insertText(
          new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(
            new Date()
          )
        )
      )
      return true
    },
  }
)

export function filterBlockItems(query: string): BlockItem[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return blockItems
  return blockItems.filter((item) =>
    [item.label, ...item.keywords].some((text) =>
      text.toLowerCase().includes(needle)
    )
  )
}

/** Enter leaves an empty run in the new paragraph, so size alone is not a test. */
function isBlankParagraph(paragraph: ProseMirrorNode) {
  let blank = true
  paragraph.forEach((child) => {
    if (child.type !== documentBodySchema.nodes.run || child.content.size > 0)
      blank = false
  })
  return blank
}

/**
 * Where the caret is, as the browser has it now. A key pressed right after a
 * click can find the editor's own selection one step behind.
 */
function caretIn(view: EditorView) {
  const { selection } = view.state
  try {
    const range = window.getSelection()
    if (
      range &&
      range.isCollapsed &&
      range.anchorNode &&
      view.dom.contains(range.anchorNode)
    )
      return view.state.doc.resolve(
        view.posAtDOM(range.anchorNode, range.anchorOffset)
      )
  } catch {
    // Fall back to the editor's selection.
  }
  return selection.empty ? selection.$from : null
}

/** The blank paragraph the caret is in, or null: where a block can be added. */
export function blankParagraphAtCaret(view: EditorView) {
  const $from = caretIn(view)
  if (!$from) return null
  const parent =
    $from.parent.type === documentBodySchema.nodes.run
      ? $from.node($from.depth - 1)
      : $from.parent
  if (
    parent.type !== documentBodySchema.nodes.paragraph ||
    !isBlankParagraph(parent)
  )
    return null
  return parent
}

/** Asks the block menu plugin of this editor to open (the + button does). */
export const openBlockMenuEvent = 'dd-open-block-menu'

type ParagraphAt = { node: ProseMirrorNode; pos: number }

/** The paragraph the caret is in (directly or through its run) and where it starts. */
function paragraphAt($from: ResolvedPos): ParagraphAt | null {
  const inRun = $from.parent.type === documentBodySchema.nodes.run
  const depth = inRun ? $from.depth - 1 : $from.depth
  const node = $from.node(depth)
  if (node.type !== documentBodySchema.nodes.paragraph) return null
  return { node, pos: $from.before(depth) }
}

function inTableCell($from: ResolvedPos) {
  for (let depth = $from.depth; depth > 0; depth--)
    if ($from.node(depth).type === documentBodySchema.nodes.table_cell)
      return true
  return false
}

/**
 * The menu lives in the line itself: "/" and what is typed after it are text
 * of an otherwise empty paragraph, and the menu is open while they stay that.
 */
const blockMenuKey = new PluginKey<{ pos: number } | null>('ddBlockMenu')

type MenuSignal = { open: number } | { close: true }

/** What follows the slash, or null when the menu should not be showing. */
function menuQuery(state: EditorState, pos: number): string | null {
  const { selection } = state
  if (!selection.empty) return null
  const line = paragraphAt(selection.$from)
  if (!line || line.pos !== pos) return null
  // The caret has to be at the end of the line, where the query is typed.
  if (selection.from !== line.pos + line.node.nodeSize - 1) return null
  const text = line.node.textContent
  if (!text.startsWith('/')) return null
  const query = text.slice(1)
  // Nothing matches: the text was not meant for the menu and stays as typed.
  if (query && !filterBlockItems(query).length) return null
  return query
}

let menuCount = 0

class BlockMenu {
  private readonly root = document.createElement('div')
  private readonly list = document.createElement('ul')
  private items = blockItems
  private query: string | null = null
  private active = 0
  private readonly id = `dd-slash-${++menuCount}`
  private readonly saved: { role: string | null; label: string | null }

  constructor(private readonly view: EditorView) {
    this.root.className = 'dd-slash'
    this.list.id = `${this.id}-list`
    this.list.setAttribute('role', 'listbox')
    this.list.setAttribute('aria-label', 'Blocks')
    this.root.append(this.list)
    // Keep the caret in the line while the pointer picks an entry.
    this.root.addEventListener('mousedown', (event) => event.preventDefault())

    const dom = view.dom
    this.saved = {
      role: dom.getAttribute('role'),
      label: dom.getAttribute('aria-label'),
    }
    dom.setAttribute('role', 'combobox')
    dom.setAttribute('aria-label', 'Insert block')
    dom.setAttribute('aria-expanded', 'true')
    dom.setAttribute('aria-controls', this.list.id)
    dom.setAttribute('aria-autocomplete', 'list')
    const host = dom.parentElement ?? document.body
    host.append(this.root)
  }

  /** Follows the text after the slash. */
  update(query: string, pos: number) {
    if (query !== this.query) {
      this.query = query
      this.items = filterBlockItems(query)
      this.active = 0
      this.render()
    }
    const host = this.view.dom.parentElement ?? document.body
    const caret = this.view.coordsAtPos(pos + 1)
    const box = host.getBoundingClientRect()
    // Flush with the left edge of the page, not indented with the text.
    this.root.style.left = '0px'
    this.root.style.top = `${caret.bottom - box.top + 4}px`
  }

  private render() {
    this.list.replaceChildren()
    this.items.forEach((item, index) => {
      const option = document.createElement('li')
      option.id = `${this.id}-${item.id}`
      option.setAttribute('role', 'option')
      option.setAttribute('aria-selected', String(index === this.active))
      option.className = 'dd-slash-option'
      const label = document.createElement('span')
      label.className = 'dd-slash-label'
      label.textContent = item.label
      const hint = document.createElement('span')
      hint.className = 'dd-slash-hint'
      hint.textContent = item.hint
      option.append(blockIcon(item.id), label, hint)
      option.addEventListener('mousedown', (event) => {
        event.preventDefault()
        this.choose(index)
      })
      this.list.append(option)
    })
    const current = this.items[this.active]
    if (current)
      this.view.dom.setAttribute(
        'aria-activedescendant',
        `${this.id}-${current.id}`
      )
    else this.view.dom.removeAttribute('aria-activedescendant')
    this.list.children[this.active]?.scrollIntoView?.({ block: 'nearest' })
  }

  /** Arrow keys, Enter and Escape; true when the key was the menu's. */
  onKey(event: KeyboardEvent) {
    if (event.isComposing) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const count = this.items.length
      if (count) {
        this.active =
          (this.active + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
        this.render()
      }
      return true
    }
    if (event.key === 'Enter') {
      this.choose(this.active)
      return true
    }
    if (event.key === 'Escape') {
      this.view.dispatch(
        this.view.state.tr.setMeta(blockMenuKey, { close: true })
      )
      return true
    }
    return false
  }

  private choose(index: number) {
    const item = this.items[index]
    const state = this.view.state
    const open = blockMenuKey.getState(state)
    const line = paragraphAt(state.selection.$from)
    if (!item || !open || !line) return
    // The slash and the filter were only a way to ask: the line is empty again.
    this.view.dispatch(
      state.tr
        .delete(line.pos + 1, line.pos + line.node.nodeSize - 1)
        .setMeta(blockMenuKey, { close: true })
    )
    this.view.focus()
    const meta: BlockMenuMeta = { headingLevel: item.headingLevel }
    item.command(this.view.state, (tr) =>
      this.view.dispatch(tr.setMeta(blockMenuMeta, meta))
    )
  }

  destroy() {
    const dom = this.view.dom
    this.root.remove()
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

/**
 * "/" in an empty paragraph opens the block menu; what is typed after it
 * filters the entries. A hint in the empty line says so (the + button opens
 * the same menu).
 */
export function blockMenuPlugin() {
  let menu: BlockMenu | null = null
  const open = (view: EditorView) => {
    if (menu || !view.editable || !blankParagraphAtCaret(view)) return false
    // The menu inserts where the editor's selection is: bring it up to date.
    const caret = caretIn(view)
    if (caret && caret.pos !== view.state.selection.from)
      view.dispatch(view.state.tr.setSelection(TextSelection.near(caret)))
    const line = paragraphAt(view.state.selection.$from)
    if (!line || inTableCell(view.state.selection.$from)) return false
    const signal: MenuSignal = { open: line.pos }
    view.dispatch(view.state.tr.insertText('/').setMeta(blockMenuKey, signal))
    return true
  }
  return new Plugin({
    key: blockMenuKey,
    state: {
      init: (): { pos: number } | null => null,
      apply(tr, value, _previous, next) {
        const signal = tr.getMeta(blockMenuKey) as MenuSignal | undefined
        let pos = value?.pos ?? null
        if (signal && 'close' in signal) return null
        if (signal) pos = signal.open
        else if (pos !== null && tr.docChanged) pos = tr.mapping.map(pos, -1)
        if (pos === null || menuQuery(next, pos) === null) return null
        return { pos }
      },
    },
    props: {
      handleKeyDown(view, event) {
        if (menu && blockMenuKey.getState(view.state)) {
          if (menu.onKey(event)) {
            event.preventDefault()
            return true
          }
          return false
        }
        if (
          event.key !== '/' ||
          event.isComposing ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return false
        if (!open(view)) return false
        event.preventDefault()
        return true
      },
      decorations(state) {
        const { selection } = state
        if (!selection.empty) return null
        const line = paragraphAt(selection.$from)
        if (!line || inTableCell(selection.$from)) return null
        const active = blockMenuKey.getState(state)
        let hint: string | null = null
        if (active)
          hint = line.node.textContent === '/' ? 'Keep typing to filter…' : null
        else if (isBlankParagraph(line.node)) hint = "Type '/' to insert…"
        if (!hint) return null
        return DecorationSet.create(state.doc, [
          Decoration.node(line.pos, line.pos + line.node.nodeSize, {
            class: active ? 'dd-hint-line' : 'dd-empty-line',
            'data-hint': hint,
          }),
        ])
      },
    },
    view: (view) => {
      const sync = () => {
        const state = blockMenuKey.getState(view.state)
        const query = state ? menuQuery(view.state, state.pos) : null
        if (state && query !== null) {
          menu ??= new BlockMenu(view)
          menu.update(query, state.pos)
        } else if (menu) {
          menu.destroy()
          menu = null
        }
      }
      const onOpen = () => open(view)
      view.dom.addEventListener(openBlockMenuEvent, onOpen)
      return {
        update: sync,
        destroy() {
          view.dom.removeEventListener(openBlockMenuEvent, onOpen)
          menu?.destroy()
          menu = null
        },
      }
    },
  })
}
