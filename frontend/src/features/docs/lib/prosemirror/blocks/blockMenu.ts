import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { Plugin, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { documentBodySchema } from '../documentBody'
import { blockMenuMeta, type BlockMenuMeta } from '../trackBlockInsert'
import { createNode, insertBlock, type Command } from './insertBlock'
import { insertDiagram, insertMathBlock } from './mediaCommands'
import { insertTable } from './tableCommands'

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

let menuCount = 0

class BlockMenu {
  private readonly root = document.createElement('div')
  private readonly input = document.createElement('input')
  private readonly list = document.createElement('ul')
  private items = blockItems
  private active = 0
  private closed = false
  private readonly id = `dd-slash-${++menuCount}`

  constructor(
    private readonly view: EditorView,
    private readonly onClose: () => void
  ) {
    this.root.className = 'dd-slash'
    this.input.className = 'dd-slash-input'
    this.input.setAttribute('role', 'combobox')
    this.input.setAttribute('aria-label', 'Insert block')
    this.input.setAttribute('aria-expanded', 'true')
    this.input.setAttribute('aria-controls', `${this.id}-list`)
    this.input.setAttribute('aria-autocomplete', 'list')
    this.input.placeholder = 'Filter blocks'
    this.list.id = `${this.id}-list`
    this.list.setAttribute('role', 'listbox')
    this.list.setAttribute('aria-label', 'Blocks')
    this.root.append(this.input, this.list)

    this.input.addEventListener('input', () => {
      this.items = filterBlockItems(this.input.value)
      this.active = 0
      this.render()
    })
    this.input.addEventListener('keydown', (event) => this.onKey(event))
    this.input.addEventListener('blur', () => this.close(false))
    this.render()

    const host = view.dom.parentElement ?? document.body
    host.append(this.root)
    const caret = view.coordsAtPos(view.state.selection.from)
    const box = host.getBoundingClientRect()
    this.root.style.left = `${Math.max(0, caret.left - box.left)}px`
    this.root.style.top = `${caret.bottom - box.top + 4}px`
    this.input.focus()
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
      empty.textContent =
        'No block matches. Clear the filter to see all blocks.'
      this.list.append(empty)
    }
    const current = this.items[this.active]
    if (current)
      this.input.setAttribute(
        'aria-activedescendant',
        `${this.id}-${current.id}`
      )
    else this.input.removeAttribute('aria-activedescendant')
  }

  private onKey(event: KeyboardEvent) {
    if (event.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const count = this.items.length
      if (!count) return
      this.active =
        (this.active + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
      this.render()
      this.list.children[this.active]?.scrollIntoView?.({ block: 'nearest' })
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
    const meta: BlockMenuMeta = { headingLevel: item.headingLevel }
    item.command(this.view.state, (tr) =>
      this.view.dispatch(tr.setMeta(blockMenuMeta, meta))
    )
  }

  close(refocus: boolean) {
    if (this.closed) return
    this.closed = true
    this.root.remove()
    this.onClose()
    if (refocus) this.view.focus()
  }
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

/** Opens the "/" block menu in an empty paragraph without writing the slash. */
export function blockMenuPlugin() {
  let menu: BlockMenu | null = null
  const open = (view: EditorView) => {
    if (menu || !view.editable || !blankParagraphAtCaret(view)) return false
    // The menu inserts where the editor's selection is: bring it up to date.
    const caret = caretIn(view)
    if (caret && caret.pos !== view.state.selection.from)
      view.dispatch(view.state.tr.setSelection(TextSelection.near(caret)))
    menu = new BlockMenu(view, () => {
      menu = null
    })
    return true
  }
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
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
    },
    view: (view) => {
      const onOpen = () => open(view)
      view.dom.addEventListener(openBlockMenuEvent, onOpen)
      return {
        destroy() {
          view.dom.removeEventListener(openBlockMenuEvent, onOpen)
          menu?.close(false)
        },
      }
    },
  })
}
