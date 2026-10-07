import type { Node as ProseMirrorNode } from 'prosemirror-model'
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import {
  alignColumnsAt,
  deleteColumnsAt,
  deleteRowsAt,
  insertColumnsAt,
  insertRowsAt,
  isNoMove,
  moveColumnsAt,
  moveRowsAt,
  setColumnWidthAt,
  setRowHeightAt,
  tableDimensions,
  type TableAlign,
} from './tableCommands'

type Axis = 'row' | 'column'

interface Range {
  tableID: string
  axis: Axis
  from: number
  to: number
}

interface Drag {
  tableID: string
  axis: Axis
  from: number
  count: number
  /** The gap the items would land in, 0..count of items; null while there is none. */
  gap: number | null
}

interface Resize {
  tableID: string
  axis: Axis
  index: number
  /** The size in pixels the column or row has while the handle is held. */
  size: number
}

/** A block of cells picked by dragging from one cell to another; inclusive, 0-based. */
interface CellBlock {
  tableID: string
  fromRow: number
  toRow: number
  fromColumn: number
  toColumn: number
}

interface ControlsState {
  selected: Range | null
  drag: Drag | null
  resize?: Resize | null
  cells?: CellBlock | null
}

const controlsKey = new PluginKey<ControlsState>('tableControls')
/** True while a drag from cell to cell is picking a block, so the browser's own selection events do not clear it. */
let pickingCells = false
const empty: ControlsState = { selected: null, drag: null }

/** Mode changes arrive as this event on the editor element, since a mode is not a transaction. */
export const tableModeEvent = 'dd-table-mode'

const DRAG_THRESHOLD = 4
const MIN_COLUMN = 48
const MIN_ROW = 24

const DISABLED_HINT = 'Switch to Edit mode to change this table'

function findTable(doc: ProseMirrorNode, tableID: string) {
  let found: { node: ProseMirrorNode; pos: number } | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (node.type.name === 'table' && node.attrs.nodeID === tableID)
      found = { node, pos }
    return node.type.name !== 'table' && !found
  })
  return found as { node: ProseMirrorNode; pos: number } | null
}

/** Puts the caret in the first cell of a row or column, so typing goes into what was just added. */
function caretInto(tr: Transaction, tableID: string, range: Range | null) {
  if (!range) return tr
  const found = findTable(tr.doc, tableID)
  if (!found) return tr
  const row = range.axis === 'row' ? range.from : 0
  const column = range.axis === 'column' ? range.from : 0
  let cellPos = found.pos + 1
  for (let r = 0; r < row && r < found.node.childCount; r++)
    cellPos += found.node.child(r).nodeSize
  const rowNode = found.node.child(Math.min(row, found.node.childCount - 1))
  cellPos += 1
  for (let c = 0; c < column && c < rowNode.childCount; c++)
    cellPos += rowNode.child(c).nodeSize
  return tr.setSelection(TextSelection.create(tr.doc, cellPos + 1))
}

function tableAtCaret(state: EditorState) {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name === 'table' && typeof node.attrs.nodeID === 'string')
      return { node, pos: $from.before(depth), nodeID: node.attrs.nodeID }
  }
  return null
}

function cellClassFor(
  state: ControlsState,
  tableID: string,
  table: ProseMirrorNode
) {
  const classes = new Map<number, string[]>()
  const { selected, drag } = state
  const dims = tableDimensions(table)
  const add = (row: number, column: number, name: string) => {
    const key = row * 10000 + column
    classes.set(key, [...(classes.get(key) ?? []), name])
  }
  const eachCell = (
    axis: Axis,
    from: number,
    to: number,
    visit: (row: number, column: number) => void
  ) => {
    for (let r = 0; r < dims.rows; r++)
      for (let c = 0; c < dims.columns; c++) {
        const index = axis === 'row' ? r : c
        if (index >= from && index <= to) visit(r, c)
      }
  }
  if (selected?.tableID === tableID) {
    const { axis, from, to } = selected
    // The outline of the picked rows or columns, drawn on the cells at its edges.
    eachCell(axis, from, to, (r, c) => {
      add(r, c, 'dd-tc-selected')
      const index = axis === 'row' ? r : c
      const other = axis === 'row' ? c : r
      const otherLast = (axis === 'row' ? dims.columns : dims.rows) - 1
      const first = axis === 'row' ? 'dd-tc-edge-top' : 'dd-tc-edge-left'
      const last = axis === 'row' ? 'dd-tc-edge-bottom' : 'dd-tc-edge-right'
      const start = axis === 'row' ? 'dd-tc-edge-left' : 'dd-tc-edge-top'
      const end = axis === 'row' ? 'dd-tc-edge-right' : 'dd-tc-edge-bottom'
      if (index === from) add(r, c, first)
      if (index === to) add(r, c, last)
      if (other === 0) add(r, c, start)
      if (other === otherLast) add(r, c, end)
    })
  }
  const block = state.cells
  if (block?.tableID === tableID)
    for (let r = block.fromRow; r <= block.toRow; r++)
      for (let c = block.fromColumn; c <= block.toColumn; c++) {
        add(r, c, 'dd-tc-selected')
        if (r === block.fromRow) add(r, c, 'dd-tc-edge-top')
        if (r === block.toRow) add(r, c, 'dd-tc-edge-bottom')
        if (c === block.fromColumn) add(r, c, 'dd-tc-edge-left')
        if (c === block.toColumn) add(r, c, 'dd-tc-edge-right')
      }
  if (drag?.tableID === tableID) {
    eachCell(drag.axis, drag.from, drag.from + drag.count - 1, (r, c) =>
      add(r, c, 'dd-tc-moving')
    )
    if (drag.gap !== null && !isNoMove(drag.from, drag.count, drag.gap)) {
      const last = (drag.axis === 'row' ? dims.rows : dims.columns) - 1
      const after = drag.gap > last
      const index = after ? last : drag.gap
      const name =
        drag.axis === 'row'
          ? after
            ? 'dd-tc-drop-bottom'
            : 'dd-tc-drop-top'
          : after
            ? 'dd-tc-drop-right'
            : 'dd-tc-drop-left'
      eachCell(drag.axis, index, index, (r, c) => add(r, c, name))
    }
  }
  return classes
}

function labelFor(axis: Axis, count: number) {
  return `${count} ${axis === 'row' ? 'row' : 'column'}${count === 1 ? '' : 's'}`
}

/**
 * The controls that sit on the table the caret is in: a bar on each column and
 * each row (click to select, Shift+click to extend, drag to move, Enter for its
 * menu), a dot between them that inserts one, and a corner for the whole table.
 * Everything here is an ordinary edit through the table commands.
 */
export function tableControlsPlugin(
  options: { canEditStructure?: () => boolean } = {}
) {
  return new Plugin<ControlsState>({
    key: controlsKey,
    state: {
      init: () => empty,
      apply(tr, value, oldState, newState) {
        const meta = tr.getMeta(controlsKey) as ControlsState | undefined
        if (meta) return meta
        // The caret moving elsewhere ends a selection of rows or columns.
        if (
          tr.selectionSet &&
          !pickingCells &&
          !oldState.selection.eq(newState.selection) &&
          (value.selected || value.cells) &&
          !value.drag
        )
          return empty
        return value
      },
    },
    props: {
      handleDOMEvents: {
        mousedown(view, event) {
          if (event.button !== 0 || event.shiftKey || !view.editable)
            return false
          // A click in the text puts the picked rows, columns or cells down, even when the caret does not move.
          const now = controlsKey.getState(view.state)
          if (now?.selected || now?.cells)
            view.dispatch(view.state.tr.setMeta(controlsKey, empty))
          trackCellDrag(view, event)
          return false
        },
        keydown(view, event) {
          if (
            (event.key !== 'Backspace' && event.key !== 'Delete') ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.isComposing ||
            !view.editable ||
            view.dom.dataset.suggestMode === 'true'
          )
            return false
          if (!clearPickedCells(view)) return false
          event.preventDefault()
          return true
        },
      },
      decorations(state) {
        const value = controlsKey.getState(state)
        if (
          !value ||
          (!value.selected && !value.drag && !value.resize && !value.cells)
        )
          return null
        const tableIDs = new Set(
          [
            value.selected?.tableID,
            value.drag?.tableID,
            value.resize?.tableID,
            value.cells?.tableID,
          ].filter((id): id is string => Boolean(id))
        )
        const decorations: Decoration[] = []
        state.doc.descendants((node, pos) => {
          if (node.type.name !== 'table') return true
          const tableID = node.attrs.nodeID as string
          if (!tableIDs.has(tableID)) return false
          const classes = cellClassFor(value, tableID, node)
          const resize = value.resize?.tableID === tableID ? value.resize : null
          node.forEach((row, rowOffset, rowIndex) => {
            if (resize?.axis === 'row' && resize.index === rowIndex) {
              const from = pos + 1 + rowOffset
              decorations.push(
                Decoration.node(from, from + row.nodeSize, {
                  style: `height:${resize.size}px`,
                })
              )
            }
            row.forEach((cell, cellOffset, cellIndex) => {
              if (resize?.axis === 'column' && resize.index === cellIndex) {
                const at = pos + 1 + rowOffset + 1 + cellOffset
                decorations.push(
                  Decoration.node(at, at + cell.nodeSize, {
                    style: `width:${resize.size}px;min-width:${resize.size}px;max-width:${resize.size}px`,
                  })
                )
              }
              const names = classes.get(rowIndex * 10000 + cellIndex)
              if (!names) return
              const from = pos + 1 + rowOffset + 1 + cellOffset
              decorations.push(
                Decoration.node(from, from + cell.nodeSize, {
                  class: names.join(' '),
                })
              )
            })
          })
          return false
        })
        return DecorationSet.create(state.doc, decorations)
      },
    },
    view(view) {
      return new TableControlsView(view, options.canEditStructure)
    },
  })
}

/** The positions of the cells that rows, columns or a block of cells has picked. */
function pickedCells(state: EditorState) {
  const value = controlsKey.getState(state)
  const found = value?.cells
    ? findTable(state.doc, value.cells.tableID)
    : value?.selected
      ? findTable(state.doc, value.selected.tableID)
      : null
  if (!value || !found) return []
  const { cells, selected } = value
  const positions: { pos: number; size: number }[] = []
  found.node.forEach((row, rowOffset, rowIndex) => {
    row.forEach((cell, cellOffset, columnIndex) => {
      const picked = cells
        ? rowIndex >= cells.fromRow &&
          rowIndex <= cells.toRow &&
          columnIndex >= cells.fromColumn &&
          columnIndex <= cells.toColumn
        : selected!.axis === 'row'
          ? rowIndex >= selected!.from && rowIndex <= selected!.to
          : columnIndex >= selected!.from && columnIndex <= selected!.to
      if (picked)
        positions.push({
          pos: found.pos + 1 + rowOffset + 1 + cellOffset,
          size: cell.nodeSize,
        })
    })
  })
  return positions
}

/** Backspace or Delete over picked cells empties them; the cells stay. Returns false when nothing is picked. */
function clearPickedCells(view: EditorView) {
  const picked = pickedCells(view.state)
  if (!picked.length) return false
  const tr = view.state.tr
  for (const { pos, size } of [...picked].reverse())
    if (size > 2) tr.delete(pos + 1, pos + size - 1)
  if (tr.docChanged) {
    const value = controlsKey.getState(view.state)
    view.dispatch(tr.setMeta(controlsKey, value ?? empty))
  }
  return true
}

function cellOf(target: EventTarget | null) {
  const cell = (target as Element | null)?.closest?.('td')
  const table = cell?.closest('table')
  const row = cell?.parentElement
  if (!cell || !table || !(row instanceof HTMLTableRowElement)) return null
  const tableID = table.dataset.nodeId
  if (!tableID) return null
  return {
    tableID,
    row: row.rowIndex,
    column: (cell as HTMLTableCellElement).cellIndex,
  }
}

/**
 * Dragging from one cell into another picks the block of cells between them,
 * not the text in reading order, which would take the left cells of the rows
 * below. The caret stays in the cell where the drag started.
 */
function trackCellDrag(view: EditorView, down: MouseEvent) {
  const anchor = cellOf(down.target)
  if (!anchor) return
  let block: CellBlock | null = null
  let anchorPos = -1
  const same = (a: CellBlock, b: CellBlock) =>
    a.fromRow === b.fromRow &&
    a.toRow === b.toRow &&
    a.fromColumn === b.fromColumn &&
    a.toColumn === b.toColumn
  // The browser keeps stretching its own text selection while the button is
  // down; the caret goes back to where the drag began each time it does.
  const publish = (next: CellBlock) => {
    const caret = view.state.selection
    const tr = view.state.tr.setMeta(controlsKey, {
      selected: null,
      drag: null,
      cells: next,
    })
    if (!caret.empty || caret.from !== anchorPos)
      tr.setSelection(TextSelection.near(view.state.doc.resolve(anchorPos)))
    if (tr.selectionSet || !block || !same(block, next)) view.dispatch(tr)
    // The editor may already hold the caret while the browser still shows a range.
    const range = window.getSelection()
    if (range && !range.isCollapsed) {
      const at = view.domAtPos(anchorPos)
      range.collapse(at.node, at.offset)
    }
    block = next
  }
  const move = (event: MouseEvent) => {
    const head = cellOf(document.elementFromPoint(event.clientX, event.clientY))
    if (!head || head.tableID !== anchor.tableID) {
      if (block) publish(block)
      return
    }
    if (!block && head.row === anchor.row && head.column === anchor.column)
      return
    if (!block) {
      pickingCells = true
      document.body.classList.add('dd-table-selecting')
      anchorPos = view.posAtDOM(down.target as Node, 0)
    }
    publish({
      tableID: anchor.tableID,
      fromRow: Math.min(anchor.row, head.row),
      toRow: Math.max(anchor.row, head.row),
      fromColumn: Math.min(anchor.column, head.column),
      toColumn: Math.max(anchor.column, head.column),
    })
  }
  const up = () => {
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', up)
    document.body.classList.remove('dd-table-selecting')
    // The browser may still report the end of the drag a moment later.
    for (const delay of [0, 30])
      setTimeout(() => {
        if (block) publish(block)
        if (delay > 0) pickingCells = false
      }, delay)
  }
  document.addEventListener('mousemove', move)
  document.addEventListener('mouseup', up)
}

class TableControlsView {
  private readonly host: HTMLElement
  private readonly layer = document.createElement('div')
  private readonly menu = document.createElement('div')
  private readonly ghost = document.createElement('div')
  private readonly announce = document.createElement('div')
  /** What the open menu belongs to, found again after a re-render: 'column:2', 'row:0', 'corner'. */
  private menuKey_: string | null = null
  private cleanup: (() => void)[] = []

  constructor(
    private readonly view: EditorView,
    private readonly canEditStructure: () => boolean = () => true
  ) {
    this.host = view.dom.parentElement ?? document.body
    this.layer.className = 'dd-tc'
    this.layer.hidden = true
    this.menu.className = 'dd-tc-menu'
    this.menu.setAttribute('role', 'menu')
    this.menu.hidden = true
    this.ghost.className = 'dd-tc-ghost'
    this.ghost.hidden = true
    this.announce.className = 'sr-only'
    this.announce.setAttribute('aria-live', 'polite')
    this.host.append(this.layer, this.menu, this.ghost, this.announce)

    const refresh = () => this.render()
    window.addEventListener('scroll', refresh, true)
    window.addEventListener('resize', refresh)
    view.dom.addEventListener(tableModeEvent, refresh)
    const outside = (event: PointerEvent) => {
      if (this.menu.hidden) return
      const target = event.target as Node
      if (this.menu.contains(target) || this.layer.contains(target)) return
      this.closeMenu()
    }
    document.addEventListener('pointerdown', outside, true)
    this.menu.addEventListener('keydown', (event) => this.menuKey(event))
    this.cleanup.push(
      () => window.removeEventListener('scroll', refresh, true),
      () => window.removeEventListener('resize', refresh),
      () => view.dom.removeEventListener(tableModeEvent, refresh),
      () => document.removeEventListener('pointerdown', outside, true)
    )
    this.render()
  }

  update() {
    this.render()
  }

  destroy() {
    this.cleanup.forEach((undo) => undo())
    this.layer.remove()
    this.menu.remove()
    this.ghost.remove()
    this.announce.remove()
    document.body.classList.remove('dd-table-dragging')
  }

  private get state() {
    return controlsKey.getState(this.view.state) ?? empty
  }

  private get enabled() {
    return (
      this.view.editable &&
      this.view.dom.dataset.suggestMode !== 'true' &&
      this.canEditStructure()
    )
  }

  private set(next: ControlsState) {
    this.view.dispatch(this.view.state.tr.setMeta(controlsKey, next))
  }

  private activeTable() {
    const caret = tableAtCaret(this.view.state)
    if (caret) return caret
    const id = this.state.selected?.tableID ?? this.state.drag?.tableID
    const found = id ? findTable(this.view.state.doc, id) : null
    return found ? { ...found, nodeID: id! } : null
  }

  // Elements are kept between renders: a drag holds the pointer on its bar,
  // and a bar replaced under it would lose the rest of the gesture.
  private readonly cache = new Map<string, HTMLElement>()
  private readonly used = new Set<string>()

  private take(key: string, make: () => HTMLElement) {
    let element = this.cache.get(key)
    if (!element) {
      element = make()
      this.cache.set(key, element)
      this.layer.append(element)
    }
    this.used.add(key)
    return element
  }

  private sweep() {
    for (const [key, element] of this.cache)
      if (!this.used.has(key)) {
        element.remove()
        this.cache.delete(key)
      }
    this.used.clear()
  }

  private render() {
    const active = this.view.editable ? this.activeTable() : null
    const dom = active ? this.view.nodeDOM(active.pos) : null
    const element =
      dom instanceof HTMLElement
        ? dom instanceof HTMLTableElement
          ? dom
          : dom.querySelector('table')
        : null
    if (!active || !element) {
      this.layer.hidden = true
      this.sweep()
      this.closeMenu()
      return
    }
    this.layer.hidden = false
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const thick = coarse ? 24 : 10
    const offset = thick + 6
    const hostBox = this.host.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    const rows = Array.from(element.rows)
    const firstRowCells = Array.from(rows[0]?.cells ?? [])
    const tableID = active.nodeID
    const { selected, drag, cells: picked } = this.state
    const enabled = this.enabled
    // Several rows, columns or cells picked: stretching one edge would be unclear, so the edges stay out of the way.
    const several =
      (selected?.tableID === tableID && selected.to > selected.from) ||
      (picked?.tableID === tableID &&
        (picked.toRow > picked.fromRow || picked.toColumn > picked.fromColumn))
    const prefix = `${tableID}|${enabled}|`
    const place = (
      node: HTMLElement,
      left: number,
      top: number,
      width: number,
      height: number
    ) => {
      node.style.left = `${left - hostBox.left}px`
      node.style.top = `${top - hostBox.top}px`
      node.style.width = `${width}px`
      node.style.height = `${height}px`
    }
    const visibleX = (left: number, right: number) =>
      right > box.left - 1 && left < box.right + 1
    // The dots sit one bar-width beyond the bars, on the outer side.
    const dotRow = box.top - offset - thick / 2 - 4
    const dotColumn = box.left - offset - thick / 2 - 4
    const isOn = (axis: Axis, index: number) =>
      selected?.tableID === tableID &&
      selected.axis === axis &&
      index >= selected.from &&
      index <= selected.to
    const isLifted = (axis: Axis, index: number) =>
      drag?.tableID === tableID &&
      drag.axis === axis &&
      index >= drag.from &&
      index < drag.from + drag.count
    const bar = (axis: Axis, index: number) => {
      const node = this.take(`${prefix}bar|${axis}|${index}`, () =>
        this.makeBar(axis, index, tableID)
      )
      node.classList.toggle('dd-tc-on', isOn(axis, index))
      node.classList.toggle('dd-tc-lifted', isLifted(axis, index))
      return node
    }
    const dot = (axis: Axis, gap: number, cx: number, cy: number) => {
      if (!enabled) return
      const node = this.take(`${prefix}dot|${axis}|${gap}`, () =>
        this.makeDot(axis, gap, tableID)
      )
      const size = 16
      node.style.left = `${cx - hostBox.left - size / 2}px`
      node.style.top = `${cy - hostBox.top - size / 2}px`
    }

    // The edge between two bars stretches the column or row before it.
    const handle = (
      axis: Axis,
      index: number,
      left: number,
      top: number,
      width: number,
      height: number
    ) => {
      if (!enabled || several) return
      const node = this.take(`${prefix}resize|${axis}|${index}`, () =>
        this.makeHandle(axis, index, tableID)
      )
      place(node, left, top, width, height)
    }

    const corner = this.take(`${prefix}corner`, () => {
      const node = this.button('dd-tc-corner', 'Table')
      node.setAttribute('aria-haspopup', 'menu')
      node.dataset.axis = 'corner'
      this.wireMenuOnly(node, () =>
        this.openCornerMenu(node.getBoundingClientRect(), tableID)
      )
      return node
    })
    place(corner, box.left - offset, box.top - offset, thick + 2, thick + 2)

    firstRowCells.forEach((cell, index) => {
      const rect = cell.getBoundingClientRect()
      if (!visibleX(rect.left, rect.right)) return
      const left = Math.max(rect.left, box.left)
      place(
        bar('column', index),
        left,
        box.top - offset,
        Math.min(rect.right, box.right) - left,
        thick
      )
      dot('column', index, rect.left, dotRow)
      handle(
        'column',
        index,
        rect.right - 4,
        box.top - offset,
        8,
        box.bottom - (box.top - offset)
      )
    })
    const lastCell = firstRowCells[firstRowCells.length - 1]
    if (lastCell)
      dot(
        'column',
        firstRowCells.length,
        lastCell.getBoundingClientRect().right,
        dotRow
      )

    rows.forEach((row, index) => {
      const rect = row.getBoundingClientRect()
      place(bar('row', index), box.left - offset, rect.top, thick, rect.height)
      dot('row', index, dotColumn, rect.top)
      handle(
        'row',
        index,
        box.left - offset,
        rect.bottom - 4,
        box.right - (box.left - offset),
        8
      )
    })
    const lastRow = rows[rows.length - 1]
    if (lastRow)
      dot('row', rows.length, dotColumn, lastRow.getBoundingClientRect().bottom)
    this.sweep()
  }

  private button(className: string, label: string) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = className
    button.setAttribute('aria-label', label)
    button.title = label
    button.addEventListener('mousedown', (event) => event.preventDefault())
    return button
  }

  private makeBar(axis: Axis, index: number, tableID: string) {
    const bar = this.button(
      `dd-tc-bar dd-tc-${axis}`,
      `${axis === 'row' ? 'Row' : 'Column'} ${index + 1}`
    )
    bar.dataset.index = String(index)
    bar.dataset.axis = axis
    bar.setAttribute('aria-haspopup', 'menu')
    bar.title = `${axis === 'row' ? 'Row' : 'Column'} ${index + 1}: click to select, drag to move`
    if (!this.enabled) {
      bar.setAttribute('aria-disabled', 'true')
      bar.title = DISABLED_HINT
      return bar
    }
    bar.addEventListener('pointerdown', (event) =>
      this.pointerDown(event, bar, axis, index, tableID)
    )
    bar.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      const anchor = bar.getBoundingClientRect()
      this.choose(axis, index, tableID, event.shiftKey)
      this.openMenu(anchor, `${axis}:${index}`)
    })
    return bar
  }

  private makeHandle(axis: Axis, index: number, tableID: string) {
    const handle = document.createElement('div')
    handle.className = `dd-tc-resize dd-tc-resize-${axis}`
    handle.title =
      axis === 'column'
        ? 'Drag to change the column width. Double-click to reset.'
        : 'Drag to change the row height. Double-click to reset.'
    handle.addEventListener('mousedown', (event) => event.preventDefault())
    handle.addEventListener('dblclick', () => {
      const found = findTable(this.view.state.doc, tableID)
      if (!found) return
      const command =
        axis === 'column'
          ? setColumnWidthAt(found.pos, index, null)
          : setRowHeightAt(found.pos, index, null)
      command(this.view.state, (tr) => this.view.dispatch(tr))
    })
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const found = findTable(this.view.state.doc, tableID)
      const dom = found ? this.view.nodeDOM(found.pos) : null
      const table =
        dom instanceof HTMLTableElement
          ? dom
          : dom instanceof HTMLElement
            ? dom.querySelector('table')
            : null
      const target =
        axis === 'column' ? table?.rows[0]?.cells[index] : table?.rows[index]
      if (!target) return
      const start = axis === 'column' ? event.clientX : event.clientY
      const initial =
        axis === 'column'
          ? target.getBoundingClientRect().width
          : target.getBoundingClientRect().height
      const least = axis === 'column' ? MIN_COLUMN : MIN_ROW
      let size = Math.round(initial)
      let moved = false
      handle.setPointerCapture?.(event.pointerId)
      document.body.classList.add(`dd-table-resizing-${axis}`)
      handle.style.cursor = axis === 'column' ? 'col-resize' : 'row-resize'

      const move = (e: PointerEvent) => {
        const delta = (axis === 'column' ? e.clientX : e.clientY) - start
        if (!moved && Math.abs(delta) < 2) return
        moved = true
        size = Math.max(least, Math.round(initial + delta))
        this.set({
          selected: this.state.selected,
          drag: null,
          resize: { tableID, axis, index, size },
        })
      }
      const finish = (commit: boolean) => {
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
        handle.removeEventListener('pointercancel', cancel)
        document.removeEventListener('keydown', escape, true)
        document.body.classList.remove(`dd-table-resizing-${axis}`)
        if (!moved) return
        const current = findTable(this.view.state.doc, tableID)
        const done =
          commit && current
            ? (axis === 'column'
                ? setColumnWidthAt(current.pos, index, size)
                : setRowHeightAt(current.pos, index, size))(
                this.view.state,
                (tr) =>
                  this.view.dispatch(
                    tr.setMeta(controlsKey, {
                      selected: this.state.selected,
                      drag: null,
                      resize: null,
                    })
                  )
              )
            : false
        if (!done) this.set({ selected: this.state.selected, drag: null })
      }
      const up = () => finish(true)
      const cancel = () => finish(false)
      const escape = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        e.stopPropagation()
        finish(false)
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', up)
      handle.addEventListener('pointercancel', cancel)
      document.addEventListener('keydown', escape, true)
    })
    return handle
  }

  private makeDot(axis: Axis, gap: number, tableID: string) {
    const dot = this.button(
      `dd-tc-dot dd-tc-dot-${axis}`,
      axis === 'row' ? 'Insert a row here' : 'Insert a column here'
    )
    dot.tabIndex = -1
    dot.style.width = '16px'
    dot.style.height = '16px'
    dot.addEventListener('click', () => {
      const found = findTable(this.view.state.doc, tableID)
      if (!found) return
      const command =
        axis === 'row'
          ? insertRowsAt(found.pos, gap, 1)
          : insertColumnsAt(found.pos, gap, 1)
      command(this.view.state, (tr) =>
        this.view.dispatch(
          caretInto(tr, tableID, { tableID, axis, from: gap, to: gap }).setMeta(
            controlsKey,
            {
              selected: { tableID, axis, from: gap, to: gap },
              drag: null,
            }
          )
        )
      )
      this.view.focus()
    })
    return dot
  }

  /** Selects one bar, or with Shift (or a tap while a selection is open) extends from the anchor. */
  private choose(axis: Axis, index: number, tableID: string, extend: boolean) {
    const current = this.state.selected
    let from = index
    let to = index
    if (current?.tableID === tableID && current.axis === axis) {
      const inside = index >= current.from && index <= current.to
      if (extend && !inside) {
        from = Math.min(current.from, index)
        to = Math.max(current.to, index)
      } else if (inside && !extend) {
        from = current.from
        to = current.to
      }
    }
    this.set({ selected: { tableID, axis, from, to }, drag: null })
  }

  private pointerDown(
    event: PointerEvent,
    bar: HTMLElement,
    axis: Axis,
    index: number,
    tableID: string
  ) {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const coarse = event.pointerType !== 'mouse'
    const anchor = bar.getBoundingClientRect()
    let dragging = false
    let count = 1
    let from = index
    bar.setPointerCapture?.(event.pointerId)

    const gapAt = (x: number, y: number) => {
      const found = findTable(this.view.state.doc, tableID)
      const dom = found ? this.view.nodeDOM(found.pos) : null
      const table =
        dom instanceof HTMLTableElement
          ? dom
          : dom instanceof HTMLElement
            ? dom.querySelector('table')
            : null
      if (!table) return null
      const rects =
        axis === 'row'
          ? Array.from(table.rows).map((row) => row.getBoundingClientRect())
          : Array.from(table.rows[0]?.cells ?? []).map((cell) =>
              cell.getBoundingClientRect()
            )
      const point = axis === 'row' ? y : x
      const mid = (r: DOMRect) =>
        axis === 'row' ? r.top + r.height / 2 : r.left + r.width / 2
      const next = rects.findIndex((r) => mid(r) > point)
      return next === -1 ? rects.length : next
    }

    // A bar that is not selected yet picks the bars it is dragged across; a
    // selected bar moves its selection. Click first to move a single row.
    let selecting = false
    const barUnder = (x: number, y: number) => {
      const bars = Array.from(
        this.layer.querySelectorAll<HTMLElement>(`[data-axis="${axis}"]`)
      )
      let nearest = index
      let best = Infinity
      for (const candidate of bars) {
        const rect = candidate.getBoundingClientRect()
        const point = axis === 'row' ? y : x
        const low = axis === 'row' ? rect.top : rect.left
        const high = axis === 'row' ? rect.bottom : rect.right
        const distance =
          point < low ? low - point : point > high ? point - high : 0
        if (distance < best) {
          best = distance
          nearest = Number(candidate.dataset.index)
        }
      }
      return nearest
    }

    const move = (e: PointerEvent) => {
      if (
        !dragging &&
        Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD
      )
        return
      if (!dragging) {
        dragging = true
        const current = this.state.selected
        if (
          current?.tableID === tableID &&
          current.axis === axis &&
          index >= current.from &&
          index <= current.to
        ) {
          from = current.from
          count = current.to - current.from + 1
        } else {
          selecting = true
          document.body.classList.add('dd-table-selecting')
          bar.style.cursor = 'crosshair'
        }
        if (!selecting) {
          document.body.classList.add('dd-table-dragging')
          bar.style.cursor = 'grabbing'
          this.ghost.textContent = `Moving ${labelFor(axis, count)}`
          this.ghost.hidden = false
        }
      }
      if (selecting) {
        const hovered = barUnder(e.clientX, e.clientY)
        const next = {
          tableID,
          axis,
          from: Math.min(index, hovered),
          to: Math.max(index, hovered),
        }
        const now = this.state.selected
        if (
          !now ||
          now.tableID !== tableID ||
          now.axis !== axis ||
          now.from !== next.from ||
          now.to !== next.to
        )
          this.set({ selected: next, drag: null })
        return
      }
      this.ghost.style.left = `${e.clientX + 14}px`
      this.ghost.style.top = `${e.clientY + 14}px`
      const gap = gapAt(e.clientX, e.clientY)
      if (this.state.drag?.gap !== gap || !this.state.drag)
        this.set({
          selected: this.state.selected,
          drag: { tableID, axis, from, count, gap },
        })
    }

    const finish = (commit: boolean) => {
      bar.removeEventListener('pointermove', move)
      bar.removeEventListener('pointerup', up)
      bar.removeEventListener('pointercancel', cancel)
      document.removeEventListener('keydown', escape, true)
      document.body.classList.remove('dd-table-dragging', 'dd-table-selecting')
      bar.style.cursor = ''
      this.ghost.hidden = true
      const drag = this.state.drag
      if (!dragging) return
      const found = findTable(this.view.state.doc, tableID)
      if (commit && drag && drag.gap !== null && found) {
        const command =
          axis === 'row'
            ? moveRowsAt(found.pos, drag.from, drag.count, drag.gap)
            : moveColumnsAt(found.pos, drag.from, drag.count, drag.gap)
        const landed = drag.gap > drag.from ? drag.gap - drag.count : drag.gap
        const moved = command(this.view.state, (tr) =>
          this.view.dispatch(
            tr.setMeta(controlsKey, {
              selected: {
                tableID,
                axis,
                from: landed,
                to: landed + drag.count - 1,
              },
              drag: null,
            })
          )
        )
        if (moved) {
          this.announce.textContent = `Moved ${labelFor(axis, drag.count)}`
          return
        }
      }
      this.set({ selected: this.state.selected, drag: null })
    }
    const up = () => {
      const wasDragging = dragging
      const picked = selecting
      finish(true)
      if (picked) {
        this.openMenu(anchor, `${axis}:${index}`)
        return
      }
      if (wasDragging) return
      // A tap on touch has no Shift: it extends an open selection instead.
      this.choose(
        axis,
        index,
        tableID,
        event.shiftKey || (coarse && Boolean(this.state.selected))
      )
      this.openMenu(anchor, `${axis}:${index}`)
    }
    const cancel = () => finish(false)
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      finish(false)
    }
    bar.addEventListener('pointermove', move)
    bar.addEventListener('pointerup', up)
    bar.addEventListener('pointercancel', cancel)
    document.addEventListener('keydown', escape, true)
  }

  private wireMenuOnly(button: HTMLElement, open: () => void) {
    if (!this.enabled) {
      button.setAttribute('aria-disabled', 'true')
      button.title = DISABLED_HINT
      return
    }
    button.addEventListener('click', open)
  }

  // ---- menus -------------------------------------------------------------

  private openCornerMenu(anchor: DOMRect, tableID: string) {
    this.showMenu(anchor, 'corner', [
      {
        label: 'Delete table',
        danger: true,
        run: () => {
          const found = findTable(this.view.state.doc, tableID)
          if (!found) return
          this.view.dispatch(
            this.view.state.tr
              .delete(found.pos, found.pos + found.node.nodeSize)
              .setMeta(controlsKey, empty)
          )
          this.view.focus()
        },
      },
    ])
  }

  private openMenu(anchor: DOMRect, key: string) {
    const range = this.state.selected
    if (!range) return
    const count = range.to - range.from + 1
    const label = labelFor(range.axis, count)
    const apply = (
      make: (pos: number) => ReturnType<typeof insertRowsAt>,
      selectAfter: Range | null,
      caret: Range | null = null
    ) => {
      const found = findTable(this.view.state.doc, range.tableID)
      if (!found) return
      make(found.pos)(this.view.state, (tr) =>
        this.view.dispatch(
          caretInto(tr, range.tableID, caret).setMeta(controlsKey, {
            selected: selectAfter,
            drag: null,
          })
        )
      )
      this.view.focus()
    }
    const items =
      range.axis === 'row'
        ? [
            {
              label: `Insert ${label} above`,
              run: () =>
                apply(
                  (pos) => insertRowsAt(pos, range.from, count),
                  range,
                  range
                ),
            },
            {
              label: `Insert ${label} below`,
              run: () =>
                apply(
                  (pos) => insertRowsAt(pos, range.to + 1, count),
                  { ...range, from: range.to + 1, to: range.to + count },
                  { ...range, from: range.to + 1, to: range.to + count }
                ),
            },
            {
              label: `Delete ${label}`,
              danger: true,
              run: () =>
                apply((pos) => deleteRowsAt(pos, range.from, range.to), null),
            },
          ]
        : [
            {
              label: `Insert ${label} left`,
              run: () =>
                apply(
                  (pos) => insertColumnsAt(pos, range.from, count),
                  range,
                  range
                ),
            },
            {
              label: `Insert ${label} right`,
              run: () =>
                apply(
                  (pos) => insertColumnsAt(pos, range.to + 1, count),
                  { ...range, from: range.to + 1, to: range.to + count },
                  { ...range, from: range.to + 1, to: range.to + count }
                ),
            },
            ...(['left', 'center', 'right'] as TableAlign[]).map((align) => ({
              label: `Align ${align}`,
              run: () =>
                apply(
                  (pos) => alignColumnsAt(pos, range.from, range.to, align),
                  range
                ),
            })),
            {
              label: `Delete ${label}`,
              danger: true,
              run: () =>
                apply(
                  (pos) => deleteColumnsAt(pos, range.from, range.to),
                  null
                ),
            },
          ]
    this.showMenu(anchor, key, items)
  }

  private showMenu(
    anchor: DOMRect,
    key: string,
    items: { label: string; danger?: boolean; run: () => void }[]
  ) {
    this.menu.replaceChildren()
    items.forEach((item) => {
      const entry = document.createElement('button')
      entry.type = 'button'
      entry.setAttribute('role', 'menuitem')
      entry.className = item.danger ? 'dd-tc-item dd-tc-danger' : 'dd-tc-item'
      entry.textContent = item.label
      entry.addEventListener('mousedown', (event) => event.preventDefault())
      entry.addEventListener('click', () => {
        this.closeMenu(false)
        item.run()
      })
      this.menu.append(entry)
    })
    this.menuKey_ = key
    this.menu.hidden = false
    const hostBox = this.host.getBoundingClientRect()
    // Beside a row bar and below a column bar, so the next bar stays reachable for Shift+click.
    const beside = key.startsWith('row:')
    this.menu.style.left = `${(beside ? anchor.right + 6 : anchor.left) - hostBox.left}px`
    this.menu.style.top = `${(beside ? anchor.top : anchor.bottom + 4) - hostBox.top}px`
    this.menu.setAttribute('aria-label', key.replace(':', ' '))
    ;(this.menu.firstElementChild as HTMLElement | null)?.focus()
  }

  private closeMenu(restoreFocus = true) {
    if (this.menu.hidden) return
    const hadFocus = this.menu.contains(document.activeElement)
    const key = this.menuKey_
    this.menu.hidden = true
    this.menu.replaceChildren()
    this.menuKey_ = null
    if (!restoreFocus || !hadFocus || !key) return
    const [axis, index] = key.split(':')
    const owner = this.layer.querySelector<HTMLElement>(
      axis === 'corner'
        ? '[data-axis="corner"]'
        : `[data-axis="${axis}"][data-index="${index}"]`
    )
    owner?.focus()
  }

  private menuKey(event: KeyboardEvent) {
    const items = Array.from(
      this.menu.querySelectorAll<HTMLElement>('[role="menuitem"]')
    )
    const at = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      event.stopPropagation()
      this.closeMenu(false)
      clearPickedCells(this.view)
      this.view.focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.closeMenu()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      items[(at + step + items.length) % items.length]?.focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus()
    }
  }
}
