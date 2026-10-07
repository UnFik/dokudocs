import { describe, expect, it } from 'vitest'
import {
  alignColumnsAt,
  deleteColumnsAt,
  deleteRowsAt,
  insertColumnsAt,
  insertRowsAt,
  moveColumnsAt,
  moveRowsAt,
  setColumnWidthAt,
  setRowHeightAt,
} from './tableCommands'
import { bodyBuilder, bodyOf, run, stateFor } from './testSupport'

function fixture(rows: string[][]) {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  const intro = b.add(root, 'paragraph')
  b.add(intro, 'run', 'intro')
  const table = b.add(root, 'table')
  rows.forEach((row) => {
    const r = b.add(table, 'table.row')
    row.forEach((text) => b.add(r, 'table.cell', text, { align: 'none' }))
  })
  const state = stateFor(b.nodes, intro)
  let tablePos = -1
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'table') tablePos = pos
    return tablePos < 0
  })
  return { state, tablePos }
}

function grid(state: ReturnType<typeof stateFor>) {
  const nodes = bodyOf(state.doc)
  const table = nodes.find((n) => n.type === 'table')
  if (!table) return null
  const order = (a: { siblingOrder: number }, c: { siblingOrder: number }) =>
    a.siblingOrder - c.siblingOrder
  return nodes
    .filter((n) => n.parentID === table.nodeID)
    .sort(order)
    .map((row) =>
      nodes
        .filter((n) => n.parentID === row.nodeID)
        .sort(order)
        .map((cell) => `${cell.content}|${cell.attributes.align}`)
    )
}

const plain = (rows: string[][]) => rows.map((r) => r.map((c) => `${c}|none`))

describe('table ranges', () => {
  const rows = [
    ['a1', 'b1', 'c1'],
    ['a2', 'b2', 'c2'],
    ['a3', 'b3', 'c3'],
    ['a4', 'b4', 'c4'],
  ]

  it('inserts several rows and columns at once', () => {
    const { state, tablePos } = fixture(rows)
    const withRows = run(state, insertRowsAt(tablePos, 1, 2)).state
    expect(grid(withRows)!.map((r) => r[0])).toEqual([
      'a1|none',
      '|none',
      '|none',
      'a2|none',
      'a3|none',
      'a4|none',
    ])
    const withColumns = run(state, insertColumnsAt(tablePos, 3, 2)).state
    expect(grid(withColumns)![0]).toEqual([
      'a1|none',
      'b1|none',
      'c1|none',
      '|none',
      '|none',
    ])
  })

  it('deletes a range of rows or columns, and the table when all go', () => {
    const { state, tablePos } = fixture(rows)
    expect(grid(run(state, deleteRowsAt(tablePos, 1, 2)).state)).toEqual(
      plain([rows[0]!, rows[3]!])
    )
    expect(grid(run(state, deleteColumnsAt(tablePos, 0, 1)).state)).toEqual(
      plain(rows.map((r) => [r[2]!]))
    )
    expect(grid(run(state, deleteRowsAt(tablePos, 0, 3)).state)).toBeNull()
    expect(grid(run(state, deleteColumnsAt(tablePos, 0, 2)).state)).toBeNull()
  })

  it('aligns a range of columns', () => {
    const { state, tablePos } = fixture(rows)
    const next = run(state, alignColumnsAt(tablePos, 1, 2, 'right')).state
    expect(grid(next)![2]).toEqual(['a3|none', 'b3|right', 'c3|right'])
  })

  it('moves rows down and up keeping their IDs', () => {
    const { state, tablePos } = fixture(rows)
    const down = run(state, moveRowsAt(tablePos, 0, 2, 4)).state
    expect(grid(down)!.map((r) => r[0])).toEqual([
      'a3|none',
      'a4|none',
      'a1|none',
      'a2|none',
    ])
    const up = run(state, moveRowsAt(tablePos, 3, 1, 1)).state
    expect(grid(up)!.map((r) => r[0])).toEqual([
      'a1|none',
      'a4|none',
      'a2|none',
      'a3|none',
    ])
    const ids = (s: typeof state) =>
      bodyOf(s.doc)
        .map((n) => n.nodeID)
        .sort()
    expect(ids(down)).toEqual(ids(state))
  })

  it('moves columns in every row, in both directions', () => {
    const { state, tablePos } = fixture(rows)
    const right = run(state, moveColumnsAt(tablePos, 0, 1, 3)).state
    expect(grid(right)![0]).toEqual(['b1|none', 'c1|none', 'a1|none'])
    expect(grid(right)![3]).toEqual(['b4|none', 'c4|none', 'a4|none'])
    const left = run(state, moveColumnsAt(tablePos, 1, 2, 0)).state
    expect(grid(left)![1]).toEqual(['b2|none', 'c2|none', 'a2|none'])
  })

  it('refuses a move that changes nothing', () => {
    const { state, tablePos } = fixture(rows)
    expect(run(state, moveRowsAt(tablePos, 1, 2, 2)).ok).toBe(false)
    expect(run(state, moveColumnsAt(tablePos, 1, 1, 2)).ok).toBe(false)
  })

  it('stores a column width on every cell of the column, and clears it', () => {
    const { state, tablePos } = fixture(rows)
    const wide = run(state, setColumnWidthAt(tablePos, 1, 180.4)).state
    const cells = bodyOf(wide.doc).filter((n) => n.type === 'table.cell')
    expect(
      cells.filter((c) => c.attributes.width === 180).map((c) => c.content)
    ).toEqual(['b1', 'b2', 'b3', 'b4'])
    expect(cells.filter((c) => 'width' in c.attributes)).toHaveLength(4)
    const reset = run(wide, setColumnWidthAt(tablePos, 1, null)).state
    expect(
      bodyOf(reset.doc).filter((n) => 'width' in n.attributes)
    ).toHaveLength(0)
  })

  it('stores a row height on the row, and keeps a width with its column when it moves', () => {
    const { state, tablePos } = fixture(rows)
    const tall = run(state, setRowHeightAt(tablePos, 2, 90)).state
    expect(
      bodyOf(tall.doc).find(
        (n) => n.type === 'table.row' && n.attributes.height === 90
      )
    ).toBeTruthy()
    const widened = run(state, setColumnWidthAt(tablePos, 0, 200)).state
    const moved = run(widened, moveColumnsAt(tablePos, 0, 1, 3)).state
    const last = grid(moved)!.map((r) => r[2])
    expect(last).toEqual(['a1|none', 'a2|none', 'a3|none', 'a4|none'])
    expect(
      bodyOf(moved.doc)
        .filter((n) => n.type === 'table.cell' && n.attributes.width === 200)
        .map((c) => c.content)
    ).toEqual(['a1', 'a2', 'a3', 'a4'])
  })

  it('refuses a size that is not positive, or an index outside the table', () => {
    const { state, tablePos } = fixture(rows)
    expect(run(state, setColumnWidthAt(tablePos, 0, 0)).ok).toBe(false)
    expect(run(state, setColumnWidthAt(tablePos, 9, 50)).ok).toBe(false)
    expect(run(state, setRowHeightAt(tablePos, 9, 50)).ok).toBe(false)
  })
})
