import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { architectureLimits, architectureSummary, architectureToJSON, countElements, seedArchitecture } from '../src/architecture'
import { mayAddElements } from '../src/permissions'

// What the server pays per update on a full canvas (500 Systems, 1000 Connections).
// Run with COLLAB_LOAD=1; the numbers go into the Architecture spec.
describe.runIf(process.env.COLLAB_LOAD)('an Architecture canvas at its limits', () => {
  const nodes = Array.from({ length: architectureLimits.nodes }, (_, i) => ({
    id: `n${i}`, kind: 'system', name: `System ${i}`, catalog: 'golang', tags: ['gin'],
    description: 'Handles orders and payments for the shop.', links: ['d1', 'd2'], x: i, y: i,
  }))
  const connections = Array.from({ length: architectureLimits.connections }, (_, i) => ({
    id: `c${i}`, source: `n${i % 500}`, target: `n${(i * 7) % 500}`, protocol: 'rest', label: 'calls', links: [],
  }))
  const doc = new Y.Doc()
  Y.applyUpdate(doc, seedArchitecture({ version: 1, nodes, connections }))
  for (let i = 0; i < 200; i++) (doc.getMap('nodes').get(`n${i}`) as Y.Map<unknown>).set('x', i * 3)
  const edit = (change: (d: Y.Doc) => void) => {
    const probe = new Y.Doc()
    probe.clientID = 42
    Y.applyUpdate(probe, Y.encodeStateAsUpdate(doc))
    const before = Y.encodeStateVector(probe)
    change(probe)
    return Y.encodeStateAsUpdate(probe, before)
  }
  const time = (runs: number, f: () => void) => {
    const t = performance.now()
    for (let i = 0; i < runs; i++) f()
    return (performance.now() - t) / runs
  }

  it('measures', () => {
    const move = edit((d) => (d.getMap('nodes').get('n1') as Y.Map<unknown>).set('x', 999))
    const add = edit((d) => d.getMap('nodes').set('extra', new Y.Map()))
    const fullCheck = () => {
      const c = new Y.Doc()
      Y.applyUpdate(c, Y.encodeStateAsUpdate(doc))
      countElements(c)
      Y.applyUpdate(c, add)
      countElements(c)
      c.destroy()
    }
    const result = {
      stateKB: +(Y.encodeStateAsUpdate(doc).length / 1024).toFixed(1),
      moveUpdateCheckMs: +time(500, () => mayAddElements(doc, move)).toFixed(3),
      addUpdateCheckMs: +time(100, () => (mayAddElements(doc, add), fullCheck())).toFixed(2),
      deriveOnStoreMs: +time(20, () => architectureSummary(architectureToJSON(doc))).toFixed(2),
    }
    console.log(JSON.stringify(result))
    expect(mayAddElements(doc, move)).toBe(false)
    expect(result.moveUpdateCheckMs).toBeLessThan(1)
  })
})
