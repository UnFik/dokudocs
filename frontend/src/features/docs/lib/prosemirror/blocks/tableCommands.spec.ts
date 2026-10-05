import { describe, expect, it } from 'vitest'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteRow,
  deleteTable,
  goToNextCell,
  goToPreviousCell,
  insertTable,
  setColumnAlign,
} from './tableCommands'
import { bodyBuilder, bodyOf, run, stateFor } from './testSupport'

function grid(rows: string[][], align: string[] = []) {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  const intro = b.add(root, 'paragraph')
  b.add(intro, 'run', 'intro')
  const empty = b.add(root, 'paragraph')
  const table = b.add(root, 'table')
  const cells: string[][] = []
  for (const row of rows) {
    const r = b.add(table, 'table.row')
    cells.push(
      row.map((text, c) => {
        const id = b.add(r, 'table.cell', text, { align: align[c] ?? 'none' })
        return id
      })
    )
  }
  return { b, root, intro, empty, table, cells }
}

function shape(state: ReturnType<typeof stateFor>) {
  const nodes = bodyOf(state.doc)
  const table = nodes.find((n) => n.type === 'table')!
  return nodes
    .filter((n) => n.parentID === table.nodeID)
    .sort((a, c) => a.siblingOrder - c.siblingOrder)
    .map((row) =>
      nodes
        .filter((n) => n.parentID === row.nodeID)
        .sort((a, c) => a.siblingOrder - c.siblingOrder)
        .map((cell) => `${cell.content}|${cell.attributes.align}`)
    )
}

describe('table commands', () => {
  it('inserts a table after the current block (no node is removed) and selects the first cell', () => {
    const b = bodyBuilder()
    const root = b.add(null, 'document')
    const intro = b.add(root, 'paragraph')
    b.add(intro, 'run', 'intro')
    const empty = b.add(root, 'paragraph')
    const state = stateFor(b.nodes, empty)
    const result = run(state, insertTable(2, 3))
    expect(result.ok).toBe(true)
    const body = bodyOf(result.state.doc)
    const rows = body.filter((n) => n.type === 'table.row')
    const cells = body.filter((n) => n.type === 'table.cell')
    expect(rows).toHaveLength(2)
    expect(cells).toHaveLength(6)
    expect(cells.every((c) => c.attributes.align === 'none')).toBe(true)
    expect(body.filter((n) => n.type === 'paragraph')).toHaveLength(2)
    expect(new Set(body.map((n) => n.nodeID)).size).toBe(body.length)
    expect(result.state.selection.$from.parent.type.name).toBe('table_cell')
  })

  it('refuses to insert a table inside a table cell', () => {
    const g = grid([['a']])
    const state = stateFor(g.b.nodes, g.cells[0]![0]!)
    expect(insertTable(2, 2)(state)).toBe(false)
  })

  it('adds a row after and before, copying column alignment', () => {
    const g = grid(
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
      ['left', 'right']
    )
    const state = stateFor(g.b.nodes, g.cells[0]![0]!)
    expect(shape(run(state, addRowAfter).state)).toEqual([
      ['a|left', 'b|right'],
      ['|left', '|right'],
      ['c|left', 'd|right'],
    ])
    expect(shape(run(state, addRowBefore).state)[0]).toEqual([
      '|left',
      '|right',
    ])
  })

  it('adds a column before and after in every row', () => {
    const g = grid(
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
      ['left', 'right']
    )
    const state = stateFor(g.b.nodes, g.cells[1]![0]!)
    expect(shape(run(state, addColumnAfter).state)).toEqual([
      ['a|left', '|none', 'b|right'],
      ['c|left', '|none', 'd|right'],
    ])
    expect(shape(run(state, addColumnBefore).state)[0]).toEqual([
      '|none',
      'a|left',
      'b|right',
    ])
  })

  it('deletes a row', () => {
    const g = grid([['a'], ['b']])
    const state = stateFor(g.b.nodes, g.cells[1]![0]!)
    expect(shape(run(state, deleteRow).state)).toEqual([['a|none']])
  })

  it('deleting the only row removes the whole table', () => {
    const g = grid([['a']])
    const state = stateFor(g.b.nodes, g.cells[0]![0]!)
    const hasTable = (result: ReturnType<typeof stateFor>) =>
      bodyOf(result.doc).some((node) => node.type === 'table')
    expect(hasTable(run(state, deleteRow).state)).toBe(false)
    expect(hasTable(run(state, deleteTable).state)).toBe(false)
  })

  it('sets the alignment of the whole column', () => {
    const g = grid([
      ['a', 'b'],
      ['c', 'd'],
    ])
    const state = stateFor(g.b.nodes, g.cells[1]![1]!)
    expect(shape(run(state, setColumnAlign('center')).state)).toEqual([
      ['a|none', 'b|center'],
      ['c|none', 'd|center'],
    ])
  })

  it('moves between cells with Tab and appends a row after the last cell', () => {
    const g = grid([
      ['a', 'b'],
      ['c', 'd'],
    ])
    let state = stateFor(g.b.nodes, g.cells[0]![1]!)
    state = run(state, goToNextCell).state
    expect(state.selection.$from.parent.attrs.nodeID).toBe(g.cells[1]![0])
    state = run(state, goToPreviousCell).state
    expect(state.selection.$from.parent.attrs.nodeID).toBe(g.cells[0]![1])

    const last = stateFor(g.b.nodes, g.cells[1]![1]!)
    const grown = run(last, goToNextCell)
    expect(shape(grown.state)).toHaveLength(3)
    expect(grown.state.selection.$from.parent.type.name).toBe('table_cell')
    expect(grown.state.selection.$from.parent.attrs.nodeID).not.toBe(
      g.cells[1]![1]
    )
  })

  it('does nothing outside a table', () => {
    const g = grid([['a']])
    const state = stateFor(g.b.nodes, g.empty)
    expect(goToNextCell(state)).toBe(false)
    expect(addRowAfter(state)).toBe(false)
  })
})
