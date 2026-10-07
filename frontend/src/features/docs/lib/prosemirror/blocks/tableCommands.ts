import type { Node as ProseMirrorNode } from 'prosemirror-model'
import {
  TextSelection,
  type EditorState,
  type Transaction,
} from 'prosemirror-state'
import { documentBodySchema } from '../documentBody'
import { insertBlock } from './insertBlock'

export type TableAlign = 'none' | 'left' | 'center' | 'right'
type Dispatch = ((tr: Transaction) => void) | undefined
type TableCommand = (state: EditorState, dispatch?: Dispatch) => boolean

const nodes = documentBodySchema.nodes

interface TableContext {
  table: ProseMirrorNode
  tablePos: number
  row: ProseMirrorNode
  rowPos: number
  rowIndex: number
  colIndex: number
}

function tableContext(state: EditorState): TableContext | null {
  const { $from } = state.selection
  for (let depth = $from.depth; depth >= 2; depth--) {
    if ($from.node(depth).type !== nodes.table_cell) continue
    const row = $from.node(depth - 1)
    const table = $from.node(depth - 2)
    if (row.type !== nodes.table_row || table.type !== nodes.table) return null
    return {
      table,
      tablePos: $from.before(depth - 2),
      row,
      rowPos: $from.before(depth - 1),
      rowIndex: $from.index(depth - 2),
      colIndex: $from.index(depth - 1),
    }
  }
  return null
}

function cellAlign(cell: ProseMirrorNode): TableAlign {
  try {
    const value: unknown = JSON.parse(cell.attrs.bodyAttributes as string)
    const align = (value as { align?: unknown }).align
    if (align === 'left' || align === 'center' || align === 'right')
      return align
  } catch {
    // Fall through to the default alignment.
  }
  return 'none'
}

function newCell(align: TableAlign) {
  return nodes.table_cell!.create({
    nodeID: null,
    bodyAttributes: JSON.stringify({ align }),
    bodyContent: '',
  })
}

function newRow(aligns: TableAlign[]) {
  return nodes.table_row!.create(
    { nodeID: null, bodyAttributes: '{}', bodyContent: '' },
    aligns.map(newCell)
  )
}

function selectCell(tr: Transaction, cellPos: number) {
  return tr.setSelection(TextSelection.create(tr.doc, cellPos + 1))
}

function cellPositions(table: ProseMirrorNode, tablePos: number) {
  const rows: number[][] = []
  table.forEach((row, rowOffset) => {
    const rowStart = tablePos + 1 + rowOffset
    const cells: number[] = []
    row.forEach((_cell, cellOffset) => cells.push(rowStart + 1 + cellOffset))
    rows.push(cells)
  })
  return rows
}

export const insertTable =
  (rows = 3, columns = 3): TableCommand =>
  (state, dispatch) => {
    if (rows < 1 || columns < 1) return false
    const table = nodes.table!.create(
      { nodeID: null, bodyAttributes: '{}', bodyContent: '' },
      Array.from({ length: rows }, () => newRow(Array(columns).fill('none')))
    )
    return insertBlock(table)(state, dispatch)
  }

const addRow =
  (side: 'before' | 'after'): TableCommand =>
  (state, dispatch) => {
    const ctx = tableContext(state)
    if (!ctx) return false
    if (dispatch) {
      const aligns: TableAlign[] = []
      ctx.row.forEach((cell) => aligns.push(cellAlign(cell)))
      const at = side === 'before' ? ctx.rowPos : ctx.rowPos + ctx.row.nodeSize
      const tr = state.tr.insert(at, newRow(aligns))
      selectCell(tr, at + 1)
      dispatch(tr.scrollIntoView())
    }
    return true
  }

export const addRowBefore = addRow('before')
export const addRowAfter = addRow('after')

const addColumn =
  (side: 'before' | 'after'): TableCommand =>
  (state, dispatch) => {
    const ctx = tableContext(state)
    if (!ctx) return false
    if (dispatch) {
      const index = ctx.colIndex + (side === 'after' ? 1 : 0)
      const positions = cellPositions(ctx.table, ctx.tablePos)
      const tr = state.tr
      for (let r = positions.length - 1; r >= 0; r--) {
        const row = positions[r]!
        const at =
          index < row.length
            ? row[index]!
            : row[row.length - 1]! + ctx.table.child(r).lastChild!.nodeSize
        tr.insert(at, newCell('none'))
      }
      const selectedRow = positions[ctx.rowIndex]!
      const target =
        index < selectedRow.length
          ? selectedRow[index]!
          : selectedRow[selectedRow.length - 1]! +
            ctx.table.child(ctx.rowIndex).lastChild!.nodeSize
      // Earlier rows are shifted by the inserted cells above the target.
      selectCell(tr, tr.mapping.map(target, -1))
      dispatch(tr.scrollIntoView())
    }
    return true
  }

export const addColumnBefore = addColumn('before')
export const addColumnAfter = addColumn('after')

export const deleteTable: TableCommand = (state, dispatch) => {
  const ctx = tableContext(state)
  if (!ctx) return false
  if (dispatch)
    dispatch(
      state.tr
        .delete(ctx.tablePos, ctx.tablePos + ctx.table.nodeSize)
        .scrollIntoView()
    )
  return true
}

/**
 * Deleting a row is a structural deletion, so the editor routes it to the
 * server DeleteNode command. Deleting the last row removes the table.
 */
export const deleteRow: TableCommand = (state, dispatch) => {
  const ctx = tableContext(state)
  if (!ctx) return false
  if (ctx.table.childCount === 1) return deleteTable(state, dispatch)
  if (dispatch)
    dispatch(
      state.tr
        .delete(ctx.rowPos, ctx.rowPos + ctx.row.nodeSize)
        .scrollIntoView()
    )
  return true
}

export const setColumnAlign =
  (align: TableAlign): TableCommand =>
  (state, dispatch) => {
    const ctx = tableContext(state)
    if (!ctx) return false
    if (dispatch) {
      const tr = state.tr
      cellPositions(ctx.table, ctx.tablePos).forEach((row) => {
        const pos = row[ctx.colIndex]
        const cell = pos === undefined ? null : state.doc.nodeAt(pos)
        if (!pos || !cell) return
        const attributes: Record<string, unknown> = JSON.parse(
          cell.attrs.bodyAttributes as string
        )
        tr.setNodeMarkup(pos, undefined, {
          ...cell.attrs,
          bodyAttributes: JSON.stringify({ ...attributes, align }),
        })
      })
      dispatch(tr)
    }
    return true
  }

function moveToCell(direction: 1 | -1): TableCommand {
  return (state, dispatch) => {
    const ctx = tableContext(state)
    if (!ctx) return false
    const positions = cellPositions(ctx.table, ctx.tablePos).flat()
    const current = positions.indexOf(
      state.selection.$from.before(state.selection.$from.depth)
    )
    const next = current + direction
    if (next < 0) return true
    if (next >= positions.length) {
      if (!dispatch) return true
      let appended: Transaction | undefined
      addRowAfter(state, (tr) => (appended = tr))
      if (appended) dispatch(appended)
      return true
    }
    if (dispatch)
      dispatch(selectCell(state.tr, positions[next]!).scrollIntoView())
    return true
  }
}

export const goToNextCell = moveToCell(1)
export const goToPreviousCell = moveToCell(-1)

// The commands below act on a table by its position and on a range of its rows
// or columns, so a menu, a drag or a shortcut can all call them. Indexes are
// 0-based and `to` is inclusive.

function tableAt(state: EditorState, tablePos: number) {
  const table = state.doc.nodeAt(tablePos)
  if (!table || table.type !== nodes.table) return null
  return { table, cells: cellPositions(table, tablePos) }
}

export function tableDimensions(table: ProseMirrorNode) {
  return { rows: table.childCount, columns: table.firstChild?.childCount ?? 0 }
}

/** `count` new rows go in before row `index` (the row count means: at the end). */
export const insertRowsAt =
  (tablePos: number, index: number, count: number): TableCommand =>
  (state, dispatch) => {
    const found = tableAt(state, tablePos)
    if (!found || count < 1 || index < 0 || index > found.table.childCount)
      return false
    if (dispatch) {
      const aligns: TableAlign[] = []
      found.table.firstChild?.forEach((cell) => aligns.push(cellAlign(cell)))
      const at =
        index < found.table.childCount
          ? found.cells[index]![0]! - 1
          : tablePos + found.table.nodeSize - 1
      const tr = state.tr.insert(
        at,
        Array.from({ length: count }, () => newRow(aligns))
      )
      dispatch(tr)
    }
    return true
  }

/** `count` new columns go in before column `index` (the column count means: at the end). */
export const insertColumnsAt =
  (tablePos: number, index: number, count: number): TableCommand =>
  (state, dispatch) => {
    const found = tableAt(state, tablePos)
    if (!found || count < 1) return false
    const { columns } = tableDimensions(found.table)
    if (index < 0 || index > columns) return false
    if (dispatch) {
      const tr = state.tr
      for (let r = found.cells.length - 1; r >= 0; r--) {
        const row = found.cells[r]!
        const at =
          index < row.length
            ? row[index]!
            : row[row.length - 1]! + found.table.child(r).lastChild!.nodeSize
        tr.insert(
          at,
          Array.from({ length: count }, () => newCell('none'))
        )
      }
      dispatch(tr)
    }
    return true
  }

/** Deleting every row deletes the table. */
export const deleteRowsAt =
  (tablePos: number, from: number, to: number): TableCommand =>
  (state, dispatch) => {
    const found = tableAt(state, tablePos)
    if (!found || from < 0 || to < from || to >= found.table.childCount)
      return false
    if (dispatch) {
      if (from === 0 && to === found.table.childCount - 1) {
        dispatch(state.tr.delete(tablePos, tablePos + found.table.nodeSize))
        return true
      }
      const start = found.cells[from]![0]! - 1
      const last = found.cells[to]!
      const end =
        last[last.length - 1]! + found.table.child(to).lastChild!.nodeSize + 1
      dispatch(state.tr.delete(start, end))
    }
    return true
  }

/** Deleting every column deletes the table. */
export const deleteColumnsAt =
  (tablePos: number, from: number, to: number): TableCommand =>
  (state, dispatch) => {
    const found = tableAt(state, tablePos)
    if (!found) return false
    const { columns } = tableDimensions(found.table)
    if (from < 0 || to < from || to >= columns) return false
    if (dispatch) {
      if (from === 0 && to === columns - 1) {
        dispatch(state.tr.delete(tablePos, tablePos + found.table.nodeSize))
        return true
      }
      const tr = state.tr
      for (let r = found.cells.length - 1; r >= 0; r--) {
        const row = found.cells[r]!
        const start = row[from]!
        const end = row[to]! + found.table.child(r).child(to).nodeSize
        tr.delete(start, end)
      }
      dispatch(tr)
    }
    return true
  }

export const alignColumnsAt =
  (
    tablePos: number,
    from: number,
    to: number,
    align: TableAlign
  ): TableCommand =>
  (state, dispatch) => {
    const found = tableAt(state, tablePos)
    if (!found) return false
    const { columns } = tableDimensions(found.table)
    if (from < 0 || to < from || to >= columns) return false
    if (dispatch) {
      const tr = state.tr
      found.cells.forEach((row) => {
        for (let c = from; c <= to; c++) {
          const cell = state.doc.nodeAt(row[c]!)
          if (!cell) continue
          const attributes: Record<string, unknown> = JSON.parse(
            cell.attrs.bodyAttributes as string
          )
          tr.setNodeMarkup(row[c]!, undefined, {
            ...cell.attrs,
            bodyAttributes: JSON.stringify({ ...attributes, align }),
          })
        }
      })
      dispatch(tr)
    }
    return true
  }

/** True when moving `count` items from `from` to the gap `gap` changes nothing. */
export const isNoMove = (from: number, count: number, gap: number) =>
  gap >= from && gap <= from + count

/**
 * Moves `count` rows starting at `from` to the gap `gap` (0..rowCount). The rows
 * are deleted and inserted again with their IDs, which the editor recognizes as
 * a move.
 */
export const moveRowsAt =
  (tablePos: number, from: number, count: number, gap: number): TableCommand =>
  (state, dispatch) => {
    const found = tableAt(state, tablePos)
    if (!found) return false
    const rows = found.table.childCount
    if (
      count < 1 ||
      from < 0 ||
      from + count > rows ||
      gap < 0 ||
      gap > rows ||
      isNoMove(from, count, gap)
    )
      return false
    if (dispatch) {
      const rowStart = (index: number) =>
        index < rows
          ? found.cells[index]![0]! - 1
          : tablePos + found.table.nodeSize - 1
      const moved: ProseMirrorNode[] = []
      for (let i = from; i < from + count; i++) moved.push(found.table.child(i))
      const tr = state.tr.delete(rowStart(from), rowStart(from + count))
      tr.insert(tr.mapping.map(rowStart(gap), -1), moved)
      dispatch(tr)
    }
    return true
  }

/** Moves `count` columns starting at `from` to the gap `gap` (0..columnCount), in every row. */
export const moveColumnsAt =
  (tablePos: number, from: number, count: number, gap: number): TableCommand =>
  (state, dispatch) => {
    const found = tableAt(state, tablePos)
    if (!found) return false
    const { columns } = tableDimensions(found.table)
    if (
      count < 1 ||
      from < 0 ||
      from + count > columns ||
      gap < 0 ||
      gap > columns ||
      isNoMove(from, count, gap)
    )
      return false
    if (dispatch) {
      const tr = state.tr
      for (let r = found.cells.length - 1; r >= 0; r--) {
        const row = found.table.child(r)
        const positions = found.cells[r]!
        const cellStart = (index: number) =>
          index < columns
            ? positions[index]!
            : positions[columns - 1]! + row.child(columns - 1).nodeSize
        const moved: ProseMirrorNode[] = []
        for (let c = from; c < from + count; c++) moved.push(row.child(c))
        const mark = tr.steps.length
        tr.delete(cellStart(from), cellStart(from + count))
        const rest = tr.mapping.slice(mark)
        tr.insert(rest.map(cellStart(gap), -1), moved)
      }
      dispatch(tr)
    }
    return true
  }

function withAttribute(
  node: ProseMirrorNode,
  key: string,
  value: number | null
) {
  const attributes: Record<string, unknown> = JSON.parse(
    node.attrs.bodyAttributes as string
  )
  if (value === null) delete attributes[key]
  else attributes[key] = Math.round(value)
  return { ...node.attrs, bodyAttributes: JSON.stringify(attributes) }
}

/** Gives every cell of a column the same width in pixels; null goes back to automatic. */
export const setColumnWidthAt =
  (tablePos: number, index: number, width: number | null): TableCommand =>
  (state, dispatch) => {
    const found = tableAt(state, tablePos)
    if (!found || index < 0 || index >= tableDimensions(found.table).columns)
      return false
    if (width !== null && !(width > 0)) return false
    if (dispatch) {
      const tr = state.tr
      found.cells.forEach((row) => {
        const cell = state.doc.nodeAt(row[index]!)
        if (cell)
          tr.setNodeMarkup(
            row[index]!,
            undefined,
            withAttribute(cell, 'width', width)
          )
      })
      dispatch(tr)
    }
    return true
  }

/** Gives a row a height in pixels (its least height); null goes back to automatic. */
export const setRowHeightAt =
  (tablePos: number, index: number, height: number | null): TableCommand =>
  (state, dispatch) => {
    const found = tableAt(state, tablePos)
    if (!found || index < 0 || index >= found.table.childCount) return false
    if (height !== null && !(height > 0)) return false
    if (dispatch) {
      const rowPos = found.cells[index]![0]! - 1
      dispatch(
        state.tr.setNodeMarkup(
          rowPos,
          undefined,
          withAttribute(found.table.child(index), 'height', height)
        )
      )
    }
    return true
  }
