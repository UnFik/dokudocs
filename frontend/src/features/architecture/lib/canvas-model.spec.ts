import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  addConnection,
  addSystem,
  applyPatches,
  updateNode,
} from './canvas-doc'
import { architectureToJSON, reuseUnchanged } from './canvas-model'

// API calls DB; each read of the state builds fresh objects.
function sample() {
  const doc = new Y.Doc()
  const api = addSystem(doc, {
    catalog: 'golang',
    name: 'API',
    x: 0,
    y: 0,
    parentId: null,
  })
  const db = addSystem(doc, {
    catalog: 'postgresql',
    name: 'DB',
    x: 300,
    y: 0,
    parentId: null,
  })
  const link = addConnection(doc, { source: api, target: db, protocol: 'sql' })
  return { doc, api, db, link }
}

describe('reading the canvas again after a change', () => {
  it('keeps the elements that did not change as they were', () => {
    const { doc, api, db, link } = sample()
    const before = architectureToJSON(doc)
    applyPatches(doc, [{ id: api, x: 40, y: 20 }])
    const after = reuseUnchanged(before, architectureToJSON(doc))
    const node = (json: typeof before, id: string) =>
      json.nodes.find((n) => n.id === id)
    expect(node(after, db)).toBe(node(before, db))
    expect(after.connections.find((c) => c.id === link)).toBe(
      before.connections.find((c) => c.id === link)
    )
  })

  it('gives a moved System its new place', () => {
    const { doc, api } = sample()
    const before = architectureToJSON(doc)
    applyPatches(doc, [{ id: api, x: 40, y: 20 }])
    const after = reuseUnchanged(before, architectureToJSON(doc))
    expect(after.nodes.find((n) => n.id === api)).toMatchObject({
      x: 40,
      y: 20,
    })
  })

  it('sees a change to the tags of a System', () => {
    const { doc, api } = sample()
    const before = architectureToJSON(doc)
    updateNode(doc, api, { tags: ['gin'] })
    const after = reuseUnchanged(before, architectureToJSON(doc))
    expect(after.nodes.find((n) => n.id === api)?.tags).toEqual(['gin'])
  })

  it('is the same canvas when nothing changed', () => {
    const { doc } = sample()
    const before = architectureToJSON(doc)
    expect(reuseUnchanged(before, architectureToJSON(doc))).toBe(before)
  })
})
