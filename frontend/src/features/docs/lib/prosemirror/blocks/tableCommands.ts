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
