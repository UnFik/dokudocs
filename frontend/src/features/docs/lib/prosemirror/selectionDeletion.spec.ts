import { describe, expect, it } from 'vitest'
import { documentBodySchema } from './documentBody'
import { planSelectionDeletion } from './selectionDeletion'
import { documentOf, paragraph, run, stateOf } from './suggestionTestKit'

const nodes = documentBodySchema.nodes
const idAttrs = (nodeID: string, bodyAttributes = '{}') => ({
  nodeID,
  bodyAttributes,
  bodyContent: '',
})

function tableDoc() {
  const cell = (id: string, text: string) =>
    nodes.table_cell!.create(idAttrs(id, '{"align":"none"}'), [
      run(`run-${id}`, [text]),
    ])
  return stateOf(
    documentOf(
      paragraph('before', [run('run-before', ['Before'])]),
      nodes.table!.create(idAttrs('table'), [
        nodes.table_row!.create(idAttrs('row1'), [
          cell('a1', 'One'),
          cell('b1', 'Two'),
        ]),
        nodes.table_row!.create(idAttrs('row2'), [
          cell('a2', 'Three'),
          cell('b2', 'Four'),
        ]),
      ]),
      paragraph('after', [run('run-after', ['After'])])
    )
  ).doc
}

const positionOf = (doc: ReturnType<typeof tableDoc>, nodeID: string) => {
  let found = -1
  doc.descendants((node, pos) => {
    if (node.attrs.nodeID === nodeID) found = pos
  })
  return found
}

describe('planSelectionDeletion', () => {
  it('clears the cells a selection from a paragraph into a table covers, and keeps the table', () => {
    const doc = tableDoc()
    const from = positionOf(doc, 'before') + 1
    const b1 = positionOf(doc, 'b1')
    const plan = planSelectionDeletion(
      doc,
      from + 2,
      b1 + doc.nodeAt(b1)!.nodeSize
    )

    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.roots).toContain('run-a1')
    expect(plan.roots).toContain('run-b1')
    expect(plan.roots).not.toContain('table')
    expect(plan.roots).not.toContain('a1')
  })

  it('deletes the whole table when the selection covers it', () => {
    const doc = tableDoc()
    const table = positionOf(doc, 'table')
    const plan = planSelectionDeletion(
      doc,
      table,
      table + doc.nodeAt(table)!.nodeSize
    )

    expect(plan).toEqual({ ok: true, roots: ['table'], trims: [] })
  })

  it('has nothing to say about a selection with nothing to delete', () => {
    const doc = tableDoc()
    const gap = positionOf(doc, 'table') - 1
    expect(planSelectionDeletion(doc, gap, gap).ok).toBe(false)
  })
})
